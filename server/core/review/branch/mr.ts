import * as queries from '../../../infrastructure/db/repositories/review/branch/mr';
import { getProject, groupMembers } from '../../projects';
import { DomainError } from '../../../models/domain-error';
import { fetchRepository } from '../../../infrastructure/git/write';
import { branches } from '../../../infrastructure/git/read';
import { IntegrationError } from '../../integrations';
import { resolveCodeHost } from '../../git';
import { toThread, type ExternalThread } from '../code/external';
import type { CodeHost, HostApprovals, HostDiscussion, MergeRequest } from '../../../models/code-host';
import { detail, ensureReview, finishThreads, repo, row, state, type ReviewRow } from './index';

/**
 * Merge requests on top of the branch review: the list of open MRs with approvals, opening one as a review
 * of its source branch, colleagues' threads and the approval. The code itself is always read from local git.
 */
export interface MrListItem {
  project_id: string; project_name: string;
  iid: number; title: string; web_url: string;
  author: { name: string; username: string };
  source_branch: string; target_branch: string;
  created_at: string; updated_at: string; notes: number;
  /** The connected account wrote this MR. */
  mine: boolean;
  /** The connected account is among the MR's reviewers. */
  reviewer: boolean;
  approvals: { count: number; required: number | null; left: number | null; mine: boolean; names: string[] } | null;
  /** Unresolved threads, and those of them the connected account started; null when not loaded for this MR. */
  threads: { open: number; mine_open: number } | null;
  /** The author pushed after the developer last published remarks from Plangent. */
  after_review: boolean;
  /** The local review of this MR, if one was opened. */
  review_id: string | null;
}
export type Resolve = (projectId: string) => Promise<{ host: CodeHost }>;
/** Unresolved resolvable threads; plain comments cannot be resolved and are not counted. */
function openThreads(discussions: HostDiscussion[], me?: number) {
  const open = discussions.filter(d => { const notes = d.notes.filter(n => !n.system && n.resolvable); return notes.length && !notes.some(n => n.resolved); });
  return { open: open.length, mine_open: me === undefined ? 0 : open.filter(d => d.notes.find(n => !n.system)?.author.id === me).length };
}
const approvalsOf = (a: HostApprovals | null) => a && { count: a.approved_by.length, required: a.required, left: a.left, mine: a.mine, names: a.approved_by.map(u => u.name || u.username) };

/** Runs the calls a few at a time: approvals are one request per MR. */
async function limited<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index]); }
  }));
  return result;
}
function members(scope: string) {
  const p = getProject(scope);
  if (!p) throw new DomainError('Проект не найден', 404);
  return p.kind === 'group' ? groupMembers(scope).filter(m => m.kind === 'project') : p.kind === 'project' ? [p] : [];
}
const hostError = (e: unknown) => e instanceof IntegrationError || e instanceof DomainError ? e.message : 'Не удалось загрузить МР';

/** Keeps the MR's diff refs on the review: the compared range and remark positions follow them. */
export function pinMr(id: string, mr: MergeRequest) {
  const refs = mr.diff_refs;
  if (refs?.head_sha) queries.pinMrUpdateBranchReviews(refs.base_sha ?? '', refs.start_sha ?? '', refs.head_sha, id);
}

/**
 * Reviews of MRs that are no longer open keep an agent session and a copy of the code in the temp folder.
 * Called with the MRs the hosting lists as open: for the others it checks the MR and cleans up when it is merged or closed.
 */
async function cleanClosed(projectId: string, host: CodeHost, openIids: Set<number>) {
  const rows = queries.rowsSelectBranchReviews(projectId) as { id: string; mr_iid: number }[];
  for (const review of rows.filter(x => !openIids.has(x.mr_iid))) {
    try {
      const { state: mrState } = await host.getMergeRequest(review.mr_iid);
      if (mrState === 'merged' || mrState === 'closed') await finishThreads(projectId, review.id);
    } catch { /* the hosting or git is unreachable: try again on the next listing */ }
  }
}

export function createMrReviews(resolve: Resolve = resolveCodeHost) {
  async function list(scope: string) {
    const items: MrListItem[] = [], errors: { project_id: string; project_name: string; message: string }[] = [];
    await Promise.all(members(scope).map(async p => {
      try {
        const { host } = await resolve(p.id);
        const [rows, me] = await Promise.all([host.listOpenMergeRequests(), host.currentUser().catch(() => null)]);
        void cleanClosed(p.id, host, new Set(rows.map(mr => mr.iid)));
        const local = new Map((queries.localSelectBranchReviews(p.id) as { mr_iid: number; id: string; published_head: string }[]).map(r => [r.mr_iid, r]));
        const mine = (mr: MergeRequest) => !!me && mr.author?.id === me.id;
        const reviewer = (mr: MergeRequest) => !!me && (mr.reviewers ?? []).some(u => u.id === me.id);
        // Threads cost a request per MR: only for the MRs the developer works with.
        const involved = (mr: MergeRequest) => mine(mr) || reviewer(mr) || local.has(mr.iid);
        const [approvals, threads] = await Promise.all([
          limited(rows, 6, mr => host.getApprovals(mr.iid).catch(() => null)),
          limited(rows, 6, mr => involved(mr) ? host.listDiscussions(mr.iid).then(d => openThreads(d, me?.id), () => null) : Promise.resolve(null)),
        ]);
        rows.forEach((mr, index) => {
          const review = local.get(mr.iid), head = mr.diff_refs?.head_sha ?? mr.sha;
          items.push({
            project_id: p.id, project_name: p.name, iid: mr.iid, title: mr.title, web_url: mr.web_url,
            author: { name: mr.author?.name ?? '', username: mr.author?.username ?? '' }, source_branch: mr.source_branch, target_branch: mr.target_branch,
            created_at: mr.created_at ?? mr.updated_at, updated_at: mr.updated_at, notes: mr.user_notes_count ?? 0,
            mine: mine(mr), reviewer: reviewer(mr), approvals: approvalsOf(approvals[index]), threads: threads[index],
            after_review: !!review?.published_head && !!head && review.published_head !== head, review_id: review?.id ?? null,
          });
        });
      } catch (e) { errors.push({ project_id: p.id, project_name: p.name, message: hostError(e) }); }
    }));
    items.sort((a, b) => a.project_name.localeCompare(b.project_name) || b.iid - a.iid);
    return { items, errors };
  }
  const pin = pinMr;
  /** Opens the MR as a review of origin/<source> against origin/<target>, after a fetch. */
  async function open(projectId: string, iid: unknown) {
    const project = repo(projectId);
    if (typeof iid !== 'number' || !Number.isSafeInteger(iid) || iid < 1) throw new DomainError('Выберите МР');
    const { host } = await resolve(projectId);
    const mr = await host.getMergeRequest(iid);
    await fetchRepository(project.repo_path);
    const refs = new Set((await branches(project.repo_path)).map(b => b.ref));
    const source = 'refs/remotes/origin/' + mr.source_branch, target = 'refs/remotes/origin/' + mr.target_branch;
    if (!refs.has(source)) throw new DomainError('Ветки ' + mr.source_branch + ' нет в origin. МР из форка пока не поддерживается.', 422);
    if (!refs.has(target)) throw new DomainError('Ветки ' + mr.target_branch + ' нет в origin', 422);
    const id = await ensureReview(projectId, source, target);
    queries.openUpdateBranchReviews(iid, id);
    pin(id, mr);
    return detail(projectId, id);
  }
  function mrOf(projectId: string, id: string): ReviewRow & { mr_iid: number } {
    const r = row(projectId, id);
    if (!r.mr_iid) throw new DomainError('Ревью открыто не из МР', 409);
    return r as ReviewRow & { mr_iid: number };
  }
  /** Everything the hosting knows about the review's MR: description, approvals and colleagues' threads. */
  async function info(projectId: string, id: string) {
    const r = mrOf(projectId, id), { host } = await resolve(projectId);
    const [mr, approvals, discussions, me] = await Promise.all([host.getMergeRequest(r.mr_iid), host.getApprovals(r.mr_iid).catch(() => null), host.listDiscussions(r.mr_iid), host.currentUser().catch(() => null)]);
    pin(id, mr);
    const threads = discussions.map(d => toThread(d, me?.id)).filter((t): t is ExternalThread => !!t);
    return {
      mr: { iid: mr.iid, title: mr.title, description: mr.description ?? '', web_url: mr.web_url, state: mr.state,
        author: { name: mr.author?.name ?? '', username: mr.author?.username ?? '' }, source_branch: mr.source_branch, target_branch: mr.target_branch, head_sha: mr.diff_refs?.head_sha ?? mr.sha },
      approvals: approvalsOf(approvals), threads,
    };
  }
  /** git fetch plus the MR's current refs, so the range matches what GitLab shows. */
  async function refresh(projectId: string, id: string) {
    const r = row(projectId, id);
    if (r.mr_iid) try { const { host } = await resolve(projectId); pin(id, await host.getMergeRequest(r.mr_iid)); } catch { /* the git part still refreshes */ }
    await fetchRepository(repo(projectId).repo_path);
    return detail(projectId, id);
  }
  /** Approves exactly the reviewed head: if the author pushed meanwhile, the developer has to look first. */
  async function approve(projectId: string, id: string, value: unknown) {
    const r = mrOf(projectId, id), { host } = await resolve(projectId);
    if (value === false) await host.unapprove(r.mr_iid);
    else {
      const [mr, s] = await Promise.all([host.getMergeRequest(r.mr_iid), state(repo(projectId), r)]);
      const head = mr.diff_refs?.head_sha ?? mr.sha;
      if (head !== s.headSha) throw new DomainError('В МР появились новые коммиты. Подтяните изменения и посмотрите их перед аппрувом.', 409);
      await host.approve(r.mr_iid, head);
    }
    return info(projectId, id);
  }
  async function discussion(projectId: string, id: string, discussionId: unknown) {
    if (typeof discussionId !== 'string' || !discussionId) throw new DomainError('Invalid discussion');
    const r = mrOf(projectId, id), { host } = await resolve(projectId);
    const found = (await host.listDiscussions(r.mr_iid)).find(d => d.id === discussionId);
    if (!found) throw new DomainError('Обсуждение не найдено в МР. Обновите треды.', 404);
    return { host, iid: r.mr_iid, found };
  }
  const text = (value: unknown, what: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 100000) throw new DomainError('Введите текст ' + what);
    return value;
  };
  async function reply(projectId: string, id: string, discussionId: unknown, body: unknown) {
    const value = text(body, 'ответа'), { host, iid } = await discussion(projectId, id, discussionId);
    await host.replyToDiscussion(iid, discussionId as string, value);
    return info(projectId, id);
  }
  async function resolveThread(projectId: string, id: string, discussionId: unknown, resolved: unknown) {
    if (typeof resolved !== 'boolean') throw new DomainError('Invalid resolved');
    const { host, iid } = await discussion(projectId, id, discussionId);
    await host.resolveDiscussion(iid, discussionId as string, resolved);
    return info(projectId, id);
  }
  /** Only the connected account's own notes may be changed. */
  async function ownNote(projectId: string, id: string, discussionId: unknown, noteId: unknown) {
    if (typeof noteId !== 'number' || !Number.isSafeInteger(noteId)) throw new DomainError('Invalid note');
    const { host, iid, found } = await discussion(projectId, id, discussionId);
    const [me, note] = [await host.currentUser(), found.notes.find(n => n.id === noteId)];
    if (!note) throw new DomainError('Комментарий не найден. Обновите треды.', 404);
    if (note.system || note.author.id !== me.id) throw new DomainError('Можно менять только свои комментарии', 403);
    return { host, iid };
  }
  async function editNote(projectId: string, id: string, discussionId: unknown, noteId: unknown, body: unknown) {
    const value = text(body, 'комментария'), { host, iid } = await ownNote(projectId, id, discussionId, noteId);
    await host.updateNote(iid, discussionId as string, noteId as number, value);
    return info(projectId, id);
  }
  async function deleteNote(projectId: string, id: string, discussionId: unknown, noteId: unknown) {
    const { host, iid } = await ownNote(projectId, id, discussionId, noteId);
    await host.deleteNote(iid, discussionId as string, noteId as number);
    return info(projectId, id);
  }
  return { list, open, info, refresh, approve, reply, resolveThread, editNote, deleteNote };
}
let service: ReturnType<typeof createMrReviews> | undefined;
export const mrReviews = () => service ??= createMrReviews();
