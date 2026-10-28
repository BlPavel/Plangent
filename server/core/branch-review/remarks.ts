import { randomUUID } from 'node:crypto';
import { getDb } from '../../infrastructure/db/schema';
import { IntegrationHttpError } from '../../infrastructure/http/integration-client';
import { broadcast } from '../shared/events';
import { CodeError } from '../code/files';
import { IntegrationError } from '../integrations';
import { resolveCodeHost } from '../code-hosts';
import { buildPosition } from '../code-hosts/position';
import type { DiffPosition, DiffRefs } from '../../models/code-host';
import type { AgentSession } from '../agent-sessions/types';
import { checkLine, repo, row, state, type ReviewRow } from './index';
import { fileDiff } from './git-diff';
import { pinMr, type Resolve } from './mr';

/**
 * Remarks the developer will publish on the merge request: their own and the agent's drafts. Nothing reaches
 * the hosting until the developer publishes; a review without an MR has its remarks copied by hand.
 */
export interface Remark {
  id: string; review_id: string;
  /** Empty for a remark on the whole merge request. */
  path: string; side: 'old' | 'new'; line: number;
  /** The branch head the line belongs to. */
  head: string;
  body: string; author: 'developer' | 'agent';
  remote_id: number | null; status: 'draft' | 'sent' | 'uncertain'; error: string; created_at: string;
  /** 1 once the developer has changed the text. */
  edited: number;
}
const db = () => getDb();
const notify = (projectId: string, reviewId: string) => broadcast({ type: 'branch_review_updated', projectId, reviewId });
const all = (reviewId: string) => db().prepare('SELECT * FROM branch_review_remarks WHERE review_id=? ORDER BY created_at,rowid').all(reviewId) as Remark[];
const body = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 100000) throw new CodeError('Введите текст замечания');
  return text;
};

/** The GitLab position of a line, from the local diff of the review's range; it throws when the line is not in the diff. */
async function position(projectId: string, id: string, path: unknown, side: unknown, line: unknown, refs?: DiffRefs): Promise<DiffPosition> {
  const { s, file } = await checkLine(projectId, id, path, side, line);
  if (file.binary) throw new CodeError('К бинарному файлу можно оставить только общее замечание');
  const diff = await fileDiff(s.root, s.from, s.headSha, file);
  const version = { id: 0, created_at: '', base_commit_sha: refs?.base_sha ?? s.from, start_commit_sha: refs?.start_sha ?? s.from, head_commit_sha: refs?.head_sha ?? s.headSha };
  try { return buildPosition(version, { old_path: file.old_path ?? file.path, new_path: file.path, diff, new_file: file.status === 'A', deleted_file: file.status === 'D', renamed_file: !!file.old_path }, side as 'old' | 'new', Number(line)); }
  catch { throw new CodeError('Замечание к строке можно оставить только в diff: на изменённой строке или рядом с ней'); }
}

export function createRemarks(resolve: Resolve = resolveCodeHost) {
  const active = new Set<string>();
  async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (active.has(id)) throw new CodeError('Публикация уже выполняется', 409);
    active.add(id);
    try { return await run(); } finally { active.delete(id); }
  }
  async function list(projectId: string, id: string) {
    const s = await state(repo(projectId), row(projectId, id));
    return { remarks: all(id).map(r => ({ ...r, edited: r.edited === 1, outdated: !!r.path && r.head !== s.headSha })) };
  }
  function draft(id: string, key: string): Remark {
    const r = db().prepare('SELECT * FROM branch_review_remarks WHERE id=? AND review_id=?').get(key, id) as Remark | undefined;
    if (!r) throw new CodeError('Замечание не найдено', 404);
    if (r.status !== 'draft') throw new CodeError('Замечание уже отправлено или требует проверки в GitLab', 409);
    return r;
  }
  async function insert(projectId: string, id: string, input: { path?: unknown; side?: unknown; line?: unknown; body?: unknown }, author: Remark['author']) {
    const r = row(projectId, id), text = body(input.body), general = input.path === undefined || input.path === '' || input.path === null;
    const side = input.side === 'old' ? 'old' : 'new';
    if (!general) await position(projectId, id, input.path, side, input.line);
    const s = await state(repo(projectId), r), key = randomUUID();
    db().prepare('INSERT INTO branch_review_remarks(id,review_id,path,side,line,head,body,author) VALUES (?,?,?,?,?,?,?,?)')
      .run(key, id, general ? '' : String(input.path), general ? 'new' : side, general ? 0 : Number(input.line), s.headSha, text, author);
    notify(projectId, id);
    return key;
  }
  async function add(projectId: string, id: string, input: Parameters<typeof insert>[2]) {
    await insert(projectId, id, input, 'developer');
    return list(projectId, id);
  }
  /** The text changes; a remark already uploaded as a GitLab draft is changed there too. */
  async function edit(projectId: string, id: string, key: string, input: { body?: unknown }) {
    const r = row(projectId, id);
    return exclusive(id, async () => {
      const d = draft(id, key), text = input.body === undefined ? d.body : body(input.body);
      if (d.remote_id !== null && r.mr_iid) await (await resolve(projectId)).host.updateDraft(r.mr_iid, d.remote_id, { body: text });
      db().prepare('UPDATE branch_review_remarks SET body=?,error=?,edited=? WHERE id=?').run(text, '', text !== d.body || d.edited ? 1 : 0, key);
      notify(projectId, id);
      return list(projectId, id);
    });
  }
  async function remove(projectId: string, id: string, key: string) {
    const r = row(projectId, id);
    return exclusive(id, async () => {
      const d = draft(id, key);
      if (d.remote_id !== null && r.mr_iid) await (await resolve(projectId)).host.deleteDraft(r.mr_iid, d.remote_id);
      db().prepare('DELETE FROM branch_review_remarks WHERE id=?').run(key);
      notify(projectId, id);
      return list(projectId, id);
    });
  }
  /** A remark on a line of an older version becomes a remark on the whole MR that names the place. */
  async function detach(projectId: string, id: string, key: string) {
    row(projectId, id);
    const d = draft(id, key);
    if (!d.path) return list(projectId, id);
    db().prepare("UPDATE branch_review_remarks SET path='',side='new',line=0,body=? WHERE id=?").run('`' + d.path + ':' + d.line + '` — ' + d.body, key);
    notify(projectId, id);
    return list(projectId, id);
  }
  /** Publication needs an explicit confirmation and the MR at the reviewed head; every confirmed remote step is saved at once. */
  async function publish(projectId: string, id: string, keys: unknown, confirmed: unknown) {
    return exclusive(id, async () => {
      if (confirmed !== true) throw new CodeError('Подтвердите публикацию');
      const r0 = row(projectId, id);
      if (!r0.mr_iid) throw new CodeError('Ревью открыто не из МР: скопируйте замечания и опубликуйте их сами', 409);
      if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== 'string') || new Set(keys).size !== keys.length) throw new CodeError('Выберите замечания');
      const selected = keys.map(k => draft(id, k as string)), iid = r0.mr_iid, { host } = await resolve(projectId);
      const mr = await host.getMergeRequest(iid);
      pinMr(id, mr);
      const r = row(projectId, id), s = await state(repo(projectId), r), refs = mr.diff_refs;
      if (!refs?.head_sha || refs.head_sha !== s.headSha) throw new CodeError('В МР появились новые коммиты. Подтяните изменения и проверьте замечания.', 409);
      const old = selected.filter(d => d.path && d.head !== s.headSha).length;
      if (old) throw new CodeError('Замечаний к прошлой версии: ' + old + '. Сделайте их общими или удалите.', 409);
      const positions = new Map<string, DiffPosition>();
      for (const d of selected) if (d.path) positions.set(d.id, await position(projectId, id, d.path, d.side, d.line, refs));
      const save = (d: Remark) => db().prepare('UPDATE branch_review_remarks SET remote_id=?,status=?,error=? WHERE id=?').run(d.remote_id, d.status, d.error, d.id);
      const sent = (d: Remark) => save({ ...d, status: 'sent', error: '' });
      const ambiguous = (e: unknown) => e instanceof IntegrationHttpError && (e.code === 'network' || (e.remote_status ?? 0) >= 500);
      const capabilities = await host.detectCapabilities(iid);
      let current: Remark | undefined;
      try {
        if (capabilities.batchReview) {
          for (const d of selected.filter(d => d.remote_id === null)) {
            current = d;
            save({ ...d, status: 'uncertain', error: 'Проверьте результат отправки в GitLab' });
            await host.createDraftNotes(iid, [{ body: d.body, position: positions.get(d.id) }], (_i, remote) => { d.remote_id = remote; save({ ...d, status: 'uncertain', error: 'Проверьте результат отправки в GitLab' }); });
          }
          current = undefined;
          for (const d of selected) save({ ...d, status: 'uncertain', error: 'Проверьте результат публикации в GitLab' });
          await host.publishDrafts(iid, selected.map(d => d.remote_id!), remote => sent(selected.find(d => d.remote_id === remote)!));
        } else for (const d of selected) {
          current = d;
          save({ ...d, status: 'uncertain', error: 'Проверьте результат отправки в GitLab' });
          await host.createDiscussion(iid, { body: d.body, position: positions.get(d.id) });
          sent(d);
        }
      } catch (e) {
        const message = e instanceof IntegrationError || e instanceof CodeError ? e.message : 'Не удалось опубликовать замечания';
        for (const d of all(id).filter(d => keys.includes(d.id) && d.status !== 'sent'))
          save({ ...d, error: message, status: ambiguous(e) && (!current || d.id === current.id) ? 'uncertain' : 'draft' });
        notify(projectId, id);
        return { ...(await list(projectId, id)), publication_error: message };
      }
      db().prepare("UPDATE branch_reviews SET published_head=?,updated_at=datetime('now') WHERE id=?").run(s.headSha, id);
      notify(projectId, id);
      return list(projectId, id);
    });
  }
  /** After an unclear failure the developer checks GitLab and says whether the remark got there. */
  async function recover(projectId: string, id: string, key: string, published: unknown) {
    row(projectId, id);
    const d = db().prepare('SELECT * FROM branch_review_remarks WHERE id=? AND review_id=?').get(key, id) as Remark | undefined;
    if (!d || d.status !== 'uncertain') throw new CodeError('Замечание не требует проверки', 409);
    if (typeof published !== 'boolean') throw new CodeError('Invalid published');
    db().prepare('UPDATE branch_review_remarks SET status=?,error=? WHERE id=?').run(published ? 'sent' : 'draft', '', key);
    notify(projectId, id);
    return list(projectId, id);
  }
  /** Without an MR the developer copies remarks out by hand; marking them sent starts the next round. */
  async function markSent(projectId: string, id: string, keys: unknown) {
    const r = row(projectId, id);
    if (r.mr_iid) throw new CodeError('Замечания этого ревью публикуются в МР', 409);
    if (!Array.isArray(keys) || !keys.length) throw new CodeError('Выберите замечания');
    const selected = keys.map(k => draft(id, String(k))), s = await state(repo(projectId), r);
    db().transaction(() => {
      for (const d of selected) db().prepare("UPDATE branch_review_remarks SET status='sent',error='' WHERE id=?").run(d.id);
      db().prepare("UPDATE branch_reviews SET published_head=?,updated_at=datetime('now') WHERE id=?").run(s.headSha, id);
    })();
    notify(projectId, id);
    return list(projectId, id);
  }
  return { list, add, insert, edit, remove, detach, publish, recover, markSent };
}
let service: ReturnType<typeof createRemarks> | undefined;
export const remarks = () => service ??= createRemarks();

/** The review an agent session belongs to. */
export function sessionReview(session: AgentSession): ReviewRow {
  const id = session.metadata.branch_review;
  const r = typeof id === 'string' ? db().prepare('SELECT * FROM branch_reviews WHERE id=?').get(id) as ReviewRow | undefined : undefined;
  if (!r) throw new CodeError('Это не сессия ревью ветки');
  return r;
}
/** add_review_remark: the agent drafts a remark; the developer edits or removes it before publishing. */
export async function agentRemark(session: AgentSession, input: Record<string, unknown>) {
  const r = sessionReview(session);
  const general = input.path === undefined || input.path === '' || input.path === null;
  if (!general && (!Number.isInteger(input.line) || Number(input.line) < 1)) throw new CodeError('A line remark needs path and line (a line of the diff); omit path for a remark on the whole merge request');
  try {
    const id = await remarks().insert(r.project_id, r.id, { ...input, body: input.text }, 'agent');
    return { saved: true, id };
  } catch (e) {
    if (e instanceof CodeError && /только в diff/.test(e.message)) throw new CodeError('The line is not in the diff of this review. Use a changed or context line of the diff (side old for removed lines), or omit path for a general remark.');
    throw e;
  }
}
