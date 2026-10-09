import { openPrivateThread, privateThreads, finishPrivateReview } from './private';
import { getProject, groupMembers } from '../projects';
import { IntegrationError } from '../integrations';
import { IntegrationHttpError } from '../../infrastructure/http/integration-client';
import { resolveCodeHost } from '../code-hosts';
import { buildPosition } from '../code-hosts/position';
import { createMrStore } from './store';
import type { MrSnapshot, ReviewRequest, MrDraft } from '../../models/mr-review';
const fail = (text: string, status = 400): never => {
  throw new IntegrationError(text, 'review_error', status);
};
const noteBody = (v: unknown) => typeof v === 'string' && v.trim() && v.length <= 100000 ? v : fail('Введите текст замечания');
export function createMrService(store = createMrStore(), resolve = resolveCodeHost) {
  const active = new Set<string>();
  async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (active.has(id))
      fail('Операция ревью уже выполняется', 409);
    active.add(id);
    try {
      return await run();
    }
    finally {
      active.delete(id);
    }
  }
  function members(scope: string) {
    const p = getProject(scope);
    if (!p)
      return fail('Project not found', 404);
    return p.kind === 'group' ? groupMembers(scope).filter(p => p.kind === 'project') : p.kind === 'project' ? [p] : [];
  }
  function requireSession(scope: string, id: string) {
    const s = store.get(id);
    if (!s || !members(scope).some(p => p.id === s.project_id))
      return fail('Review not found', 404);
    return s;
  }
  async function context(scope: string, id: string) {
    const s = requireSession(scope, id), c = await resolve(s.project_id);
    if (c.connectionId !== s.connection_id || c.projectPath !== s.project_path)
      fail('Подключение изменилось. Откройте МР заново.', 409);
    return { s, ...c };
  }
  async function load(c: Awaited<ReturnType<typeof resolveCodeHost>>, iid: number, versionId?: number): Promise<MrSnapshot> {
    const [mr, versions, discussions, capabilities] = await Promise.all([c.host.getMergeRequest(iid), c.host.getVersions(iid), c.host.listDiscussions(iid), c.host.detectCapabilities(iid)]);
    const version = versionId === undefined ? versions[0] : versions.find(v => v.id === versionId);
    if (!version)
      return fail('Версия diff ещё не готова. Обновите МР.', 409);
    return { mr, versions, discussions, capabilities: { ...capabilities }, version, files: await c.host.getDiff(iid, version.id) };
  }
  async function list(scope: string, query?: string) {
    const requests: ReviewRequest[] = [], errors: {
      project_id: string;
      message: string;
    }[] = [];
    for (const p of members(scope))
      try {
        const c = await resolve(p.id), rows = query === undefined ? await c.host.listReviewRequests() : await c.host.searchMergeRequests(query);
        for (const mr of rows) {
          const old = store.find(p.id, c.connectionId, c.projectPath, mr.iid);
          requests.push({ project_id: p.id, project_name: p.name, mr, has_updates: !!old && (old.snapshot.mr.updated_at !== mr.updated_at || old.snapshot.mr.sha !== mr.sha) });
        }
      }
      catch (e) {
        errors.push({ project_id: p.id, message: e instanceof IntegrationError ? e.message : 'Не удалось загрузить МР' });
      }
    return { requests, errors };
  }
  async function open(scope: string, input: {
    url?: unknown;
    project_id?: unknown;
    iid?: unknown;
  }) {
    let owner: string | undefined, iid: number | undefined;
    if (typeof input.url === 'string' && input.url.trim()) {
      let url: URL;
      try {
        url = new URL(input.url);
      }
      catch {
        return fail('Неверная ссылка МР');
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        return fail('Неверная ссылка МР');
      const m = /^\/(.+)\/-\/merge_requests\/(\d+)\/?$/.exec(url.pathname);
      if (!m)
        return fail('Неверная ссылка МР');
      const matches: string[] = [];
      for (const p of members(scope)) {
        let c: Awaited<ReturnType<typeof resolve>>;
        try {
          c = await resolve(p.id);
        }
        catch {
          continue;
        }
        if (c.baseUrl === url.origin && c.projectPath === decodeURIComponent(m[1]))
          matches.push(p.id);
      }
      if (matches.length !== 1)
        return fail(matches.length ? 'Ссылке соответствуют несколько проектов' : 'Нет репозитория для этой ссылки');
      owner = matches[0];
      iid = +m[2];
    }
    else if (typeof input.project_id === 'string' && typeof input.iid === 'number') {
      owner = input.project_id;
      iid = input.iid;
    }
    if (!owner || !members(scope).some(p => p.id === owner) || !Number.isSafeInteger(iid) || iid! < 1)
      return fail('Выберите МР');
    const c = await resolve(owner);
    const existing = store.find(owner, c.connectionId, c.projectPath, iid!);
    return exclusive(existing?.id ?? owner + ':' + iid, async () => {
      const snapshot = await load(c, iid!);
      const s = store.save(owner!, c.connectionId, c.projectPath, iid!, snapshot);
      return store.detail(s.id);
    });
  }
  function detail(scope: string, id: string) {
    requireSession(scope, id);
    return store.detail(id);
  }
  async function refresh(scope: string, id: string, version?: number) {
    return exclusive(id, async () => {
      const { s, ...c } = await context(scope, id);
      store.save(s.project_id, s.connection_id, s.project_path, s.iid, await load(c, s.iid, version));
      return detail(scope, id);
    });
  }
  async function file(scope: string, id: string, p: string, head?: string) {
    const { s, host } = await context(scope, id), f = s.snapshot.files.find(f => f.new_path === p);
    if (head !== undefined && head !== s.snapshot.version.head_commit_sha)
      return fail('Версия ревью изменилась. Обновите МР.', 409);
    if (!f)
      return fail('File not found', 404);
    if (f.too_large || f.collapsed)
      return fail('GitLab ограничил diff. Откройте файл в GitLab.', 422);
    return { content: f.deleted_file ? '' : await host.getFile(f.new_path, s.snapshot.version.head_commit_sha) };
  }
  async function addDraft(scope: string, id: string, input: {
    body?: unknown;
    head?: unknown;
    path?: unknown;
    side?: unknown;
    line?: unknown;
  }) {
    return exclusive(id, async () => {
      const s = requireSession(scope, id), body = noteBody(input.body);
      let position = null;
      if (input.head !== undefined && input.head !== s.snapshot.version.head_commit_sha)
        return fail('Версия ревью изменилась. Обновите МР.', 409);
      if (input.path !== undefined) {
        const f = s.snapshot.files.find(f => f.new_path === input.path);
        if (!f)
          return fail('File not found', 404);
        if (typeof input.line !== 'number' || !['new', 'old'].includes(String(input.side)))
          return fail('Invalid line');
        position = buildPosition(s.snapshot.version, f, input.side as 'old' | 'new', input.line);
      }
      return store.add(id, body, position);
    });
  }
  function draft(scope: string, id: string, key: string) {
    requireSession(scope, id);
    const d = store.drafts(id).find(d => d.id === key);
    if (!d)
      return fail('Draft not found', 404);
    if (d.status !== 'draft')
      return fail('Замечание отправлено или требует проверки в GitLab', 409);
    return d;
  }
  async function editDraft(scope: string, id: string, key: string, value: unknown) {
    return exclusive(id, async () => {
      const d = draft(scope, id, key), body = noteBody(value);
      if (d.remote_id !== null) {
        const { s, host } = await context(scope, id);
        await host.updateDraft(s.iid, d.remote_id, { body, position: d.position ?? undefined });
      }
      store.update({ ...d, body, error: '' });
      return detail(scope, id);
    });
  }
  async function removeDraft(scope: string, id: string, key: string) {
    return exclusive(id, async () => {
      const d = draft(scope, id, key);
      if (d.remote_id !== null) {
        const { s, host } = await context(scope, id);
        await host.deleteDraft(s.iid, d.remote_id);
      }
      store.remove(id, key);
      return detail(scope, id);
    });
  }
  async function publish(scope: string, id: string, keys: unknown, confirmed: unknown) {
    return exclusive(id, async () => {
      if (confirmed !== true)
        return fail('Подтвердите публикацию');
      if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== 'string') || new Set(keys).size !== keys.length)
        return fail('Выберите черновики');
      const selected = keys.map(k => draft(scope, id, k)), { s, host } = await context(scope, id), mr = await host.getMergeRequest(s.iid);
      if (selected.some(d => d.position && d.position.head_sha !== mr.diff_refs?.head_sha))
        return fail('МР изменился. Обновите его и перенесите замечания на актуальные строки.', 409);
      const capabilities = await host.detectCapabilities(s.iid);
      const sent = (d: MrDraft) => store.update({ ...d, status: 'sent', error: '' });
      const ambiguous = (e: unknown) => e instanceof IntegrationHttpError && (e.code === 'network' || (e.remote_status ?? 0) >= 500);
      let current: MrDraft | undefined;
      try {
        if (capabilities.batchReview) {
          for (const d of selected.filter(d => d.remote_id === null)) {
            current = d;
            store.update({ ...d, status: 'uncertain', error: 'Проверьте результат отправки в GitLab' });
            await host.createDraftNotes(s.iid, [{ body: d.body, position: d.position ?? undefined }], (_i, remote_id) => {
              d.remote_id = remote_id;
              store.update(d);
            });
          }
          current = undefined;
          for (const d of selected)
            store.update({ ...d, status: 'uncertain', error: 'Проверьте результат публикации в GitLab' });
          await host.publishDrafts(s.iid, selected.map(d => d.remote_id!), remote_id => sent(selected.find(d => d.remote_id === remote_id)!));
        }
        else
          for (const d of selected) {
            current = d;
            store.update({ ...d, status: 'uncertain', error: 'Проверьте результат отправки в GitLab' });
            await host.createDiscussion(s.iid, { body: d.body, position: d.position ?? undefined });
            sent(d);
          }
      }
      catch (e) {
        const message = e instanceof IntegrationError ? e.message : 'Не удалось опубликовать ревью';
        for (const d of store.drafts(id).filter(d => keys.includes(d.id) && d.status !== 'sent'))
          store.update({ ...d, error: message, status: ambiguous(e) && (!current || d.id === current.id) ? 'uncertain' : 'draft' });
        return { ...detail(scope, id), publication_error: message };
      }
      try {
        s.snapshot.discussions = await host.listDiscussions(s.iid);
        store.save(s.project_id, s.connection_id, s.project_path, s.iid, s.snapshot);
      }
      catch {
      }
      return detail(scope, id);
    });
  }
  async function recover(scope: string, id: string, key: string, published: unknown, confirmed: unknown) {
    return exclusive(id, async () => {
      requireSession(scope, id);
      const d = store.drafts(id).find(d => d.id === key);
      if (!d || d.status !== 'uncertain')
        return fail('Замечание не требует проверки', 409);
      if (typeof published !== 'boolean' || confirmed !== true)
        return fail('Подтвердите проверку замечания в GitLab');
      store.update({ ...d, status: published ? 'sent' : 'draft', error: '' });
      return detail(scope, id);
    });
  }
  async function reply(scope: string, id: string, discussion: string, body: unknown) {
    return exclusive(id, async () => {
      const { s, host } = await context(scope, id);
      if (!s.snapshot.discussions.some(d => d.id === discussion))
        return fail('Discussion not found', 404);
      await host.replyToDiscussion(s.iid, discussion, noteBody(body));
      s.snapshot.discussions = await host.listDiscussions(s.iid);
      store.save(s.project_id, s.connection_id, s.project_path, s.iid, s.snapshot);
      return detail(scope, id);
    });
  }
  async function approve(scope: string, id: string, value: boolean) {
    return exclusive(id, async () => {
      const { s, host } = await context(scope, id);
      if (value)
        await host.approve(s.iid, s.snapshot.version.head_commit_sha);
      else
        await host.unapprove(s.iid);
      return detail(scope, id);
    });
  }
  function viewed(scope: string, id: string, p: unknown, value: unknown) {
    const s = requireSession(scope, id);
    if (typeof p !== 'string' || !s.snapshot.files.some(f => f.new_path === p) || typeof value !== 'boolean')
      return fail('Invalid viewed file');
    if (active.has(id))
      return fail('Review busy', 409);
    store.viewed(id, p, value);
    return detail(scope, id);
  }
  async function thread(scope: string, id: string, input: Parameters<typeof openPrivateThread>[2]) {
    return exclusive(id, async () => { const { s, host } = await context(scope,id); return openPrivateThread(s,host.mergeRequestRef(s.iid),input); });
  }
  function threads(scope: string, id: string) { requireSession(scope,id); return privateThreads(id); }
  async function finishReview(scope: string,id: string) { return exclusive(id, () => finishPrivateReview(requireSession(scope,id))); }
  return { thread, threads, finishReview, list, open, detail, refresh, file, addDraft, editDraft, removeDraft, publish, recover, reply, approve, viewed };
}
let singleton: ReturnType<typeof createMrService> | undefined;
export const mrReviews = () => singleton ??= createMrService();
