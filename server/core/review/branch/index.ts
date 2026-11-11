import * as queries from '../../../infrastructure/db/repositories/review/branch/index';
import { ensureReviewWorktree, removeReviewWorktrees } from '../../git';
export { reviewWorkspace } from '../../git';
import { randomUUID } from 'node:crypto';
import { getProject } from '../../projects';
import { reviewAgent } from '../../settings';
import { DomainError } from '../../../models/domain-error';
import { runGit, serializeGit } from '../../../infrastructure/git/write';
import { getAgent } from '../../agents';
import { getTask } from '../../tasks';
import { createAgentSession, getSession, updateSession } from '../../agents';
import { closeSession } from '../../agents';
import { commitOf, fileAt, fileDiff, isAncestor, mergeBase, rangeCommits, rangeCount, rangeFiles, resolveRef } from './git-diff';

export interface ReviewRow {
  id: string; project_id: string; branch: string; base: string; seen_head: string;
  /** Set when the review was opened from a merge request; its diff refs pin the compared range to the MR's. */
  mr_iid: number | null; mr_base: string; mr_start: string; mr_head: string;
  context: string; task_id: string | null; skill_id: string | null;
  overview: string; overview_head: string;
  /** Head of the branch when the developer last published remarks: the next round starts there. */
  published_head: string;
  /** The agent's review: '' before it, running, done, stopped (by the developer) or failed. */
  analysis_status: import('@contracts').BranchReview['review']['analysis_status']; analysis_session: string;
  /** The developer's wish for the review, shown with the report. */
  analysis_note: string;
}
/** The agent picked for a review instead of the project's review agent. */
export interface AgentChoice { agentId?: string; model?: string; effort?: string }
interface Thread { id: string; review_id: string; head: string; path: string; side: string; line: number; session_id: string }

export function repo(projectId: string) {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project') throw new DomainError('Проект не найден', 404);
  return project;
}
export function row(projectId: string, id: string): ReviewRow {
  const r = queries.rSelectBranchReviews(id, projectId) as ReviewRow | undefined;
  if (!r) throw new DomainError('Ревью не найдено', 404);
  return r;
}
export async function state(project: ReturnType<typeof repo>, r: ReviewRow) {
  const root = project.repo_path;
  const [head, base] = await Promise.all([resolveRef(root, r.branch), resolveRef(root, r.base)]);
  const headSha = await commitOf(root, head.ref), baseSha = await commitOf(root, base.ref);
  // The MR's own base gives exactly the diff GitLab shows, so remark positions match its lines.
  const pinned = r.mr_iid && r.mr_head === headSha && r.mr_base ? await commitOf(root, r.mr_base).catch(() => '') : '';
  const from = pinned || await mergeBase(root, baseSha, headSha);
  return { root, head, base, headSha, from };
}

/** One review per branch pair; opening it again returns the same review with its remarks and chats. */
export async function ensureReview(projectId: string, branchRef: unknown, baseRef: unknown): Promise<string> {
  const project = repo(projectId), root = project.repo_path;
  const head = await resolveRef(root, branchRef), base = await resolveRef(root, baseRef);
  if (head.ref === base.ref) throw new DomainError('Выберите разные ветки');
  const existing = queries.existingSelectBranchReviews(projectId, head.ref, base.ref) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  // A new review starts with the skill used last in this project.
  const last = queries.lastSelectBranchReviews(projectId) as { skill_id: string } | undefined;
  queries.ensureReviewInsertBranchReviews(id, projectId, head.ref, base.ref, last?.skill_id ?? null);
  return id;
}
export async function detail(projectId: string, id: string) {
  const project = repo(projectId), r = row(projectId, id), s = await state(project, r);
  const [files, commits, count] = await Promise.all([rangeFiles(s.root, s.from, s.headSha), rangeCommits(s.root, s.from, s.headSha), rangeCount(s.root, s.from, s.headSha)]);
  const moved = !!r.seen_head && r.seen_head !== s.headSha;
  const descends = moved && await isAncestor(s.root, r.seen_head, s.headSha);
  // The next round: files the author changed after the developer's last publication.
  const round = r.published_head && r.published_head !== s.headSha && await isAncestor(s.root, r.published_head, s.headSha)
    ? { commits: await rangeCount(s.root, r.published_head, s.headSha), files: new Set((await rangeFiles(s.root, r.published_head, s.headSha)).map(f => f.path)) } : null;
  return {
    review: { id, project_id: projectId, branch: r.branch, base: r.base, branch_name: s.head.name, base_name: s.base.name, head: s.headSha, merge_base: s.from,
      mr_iid: r.mr_iid, context: r.context, task_id: r.task_id, skill_id: r.skill_id, overview: r.overview, overview_head: r.overview_head, published_head: r.published_head,
      analysis_status: r.analysis_status, analysis_session: r.analysis_session, analysis_note: r.analysis_note },
    files: files.map(f => ({ ...f, changed_since: !!round?.files.has(f.path) })),
    commits, commit_count: count,
    new_commits: descends ? await rangeCount(s.root, r.seen_head, s.headSha) : 0,
    /** The branch was force-pushed since the last acknowledged state. */
    rewritten: moved && !descends,
    /** Commits after the last publication; zero before the first one. */
    round_commits: round?.commits ?? 0,
  };
}
export async function acknowledge(projectId: string, id: string) {
  const s = await state(repo(projectId), row(projectId, id));
  queries.acknowledgeUpdateBranchReviews(s.headSha, id);
  return detail(projectId, id);
}
export async function findFile(projectId: string, id: string, p: unknown) {
  const s = await state(repo(projectId), row(projectId, id));
  const file = (await rangeFiles(s.root, s.from, s.headSha)).find(f => f.path === p);
  if (!file) throw new DomainError('Файл не найден в ревью', 404);
  return { s, file };
}
export async function diff(projectId: string, id: string, p: unknown) {
  const { s, file } = await findFile(projectId, id, p);
  return { diff: file.binary ? '' : await fileDiff(s.root, s.from, s.headSha, file) };
}
export async function content(projectId: string, id: string, p: unknown) {
  const { s, file } = await findFile(projectId, id, p);
  if (file.status === 'D' || file.binary) return { content: '' };
  return { content: await fileAt(s.root, s.headSha, file.path) };
}
/** The developer's context for the agent: free text, a Plangent task and the review skill. */
export function setContext(projectId: string, id: string, input: { context?: unknown; task_id?: unknown; skill_id?: unknown }) {
  const r = row(projectId, id);
  const context = typeof input.context === 'string' ? input.context.slice(0, 20000) : r.context;
  const task = input.task_id === undefined ? r.task_id : typeof input.task_id === 'string' && input.task_id ? input.task_id : null;
  const owner = task ? getTask(task)?.project_id : null;
  if (task && owner !== projectId && owner !== repo(projectId).group_id) throw new DomainError('Задача не найдена', 404);
  const skill = input.skill_id === undefined ? r.skill_id : typeof input.skill_id === 'string' && input.skill_id ? input.skill_id : null;
  queries.setContextUpdateBranchReviews(context, task, skill, id);
  return detail(projectId, id);
}

/** Validates a question's place: the file is in the review and the line number is sane. */
export async function checkLine(projectId: string, id: string, p: unknown, side: unknown, line: unknown) {
  if (!['old', 'new'].includes(String(side)) || !Number.isSafeInteger(Number(line)) || Number(line) < 1) throw new DomainError('Некорректная строка');
  return findFile(projectId, id, p);
}
export function threads(projectId: string, id: string): Thread[] {
  row(projectId, id);
  return queries.threadsSelectBranchReviewThreads(id) as Thread[];
}
/**
 * The thread to send a prompt to. A session that has just been created is `starting` only because nothing was sent to it yet,
 * so only an already existing session can be busy.
 */
export async function openIdleThread(projectId: string, id: string, busyMessage: string, choice?: AgentChoice) {
  const known = new Set(threads(projectId, id).map(t => t.session_id));
  const thread = await openThread(projectId, id, {}, choice);
  if (known.has(thread.session_id) && ['starting', 'thinking'].includes(getSession(thread.session_id).status)) throw new DomainError(busyMessage, 409);
  return thread;
}
const briefing = (r: ReviewRow, head: string) =>
  'You review the branch with the developer; do not change code or git. First call get_review_brief for the MR description, context, review skill, colleague discussions, and rules. ' +
  'Developer questions arrive in batches: call get_branch_questions and reply in each thread through reply_branch_question, not in chat. ' +
  'The branch is available in the current worktree (commit ' + head + '), compared with ' + r.base + '; use git diff and git log there. Respond in the developer’s language, Russian by default.';
/** A chat about the whole branch (no path) or about one line of one file. Code lives in a detached read-only worktree. */
export async function openThread(projectId: string, id: string, input: { path?: unknown; side?: unknown; line?: unknown }, choice?: AgentChoice) {
  const project = repo(projectId), r = row(projectId, id);
  // Who reviews is the project's review agent (like the agent for commits) unless the developer picked another when starting.
  const agent = reviewAgent(projectId, choice);
  if (!getAgent(agent.agentId)) throw new DomainError('Агент для ревью не найден: выберите другого в настройках проекта', 409);
  const s = await state(project, r);
  const wholeBranch = input.path === undefined || input.path === '';
  const line = wholeBranch ? 0 : Number(input.line);
  if (!wholeBranch && (!['old', 'new'].includes(String(input.side)) || !Number.isSafeInteger(line) || line < 1)) throw new DomainError('Некорректная строка');
  const file = wholeBranch ? undefined : (await findFile(projectId, id, input.path)).file;
  const side = file ? String(input.side) : 'new', filePath = file?.path ?? '';
  return serializeGit(s.root, async () => {
    const existing = threads(projectId, id).find(t => t.head === s.headSha && t.path === filePath && t.side === side && t.line === line);
    if (existing) return existing;
    await ensureReviewWorktree(s.root, id, s.headSha);
    const session = createAgentSession({ project_id: projectId, agent_id: agent.agentId, role: 'chat', policy: 'read-only', model: agent.model,
      title: 'Ревью · ' + (r.mr_iid ? '!' + r.mr_iid + ' · ' : '') + s.head.name + (file ? ' · ' + file.path + ':' + line : ''),
      metadata: { mr_private: true, briefing: briefing(r, s.headSha), branch_review: id, ...(agent.effort ? { reasoningEffort: agent.effort } : {}) } });
    queries.openThreadInsertBranchReviewThreads(session.id, id, s.headSha, filePath, side, line, session.id);
    return { id: session.id, review_id: id, head: s.headSha, path: filePath, side, line, session_id: session.id };
  });
}
/** Removes worktrees and closes agents; the remarks and the chat history stay. */
export async function finishThreads(projectId: string, id: string) {
  const project = repo(projectId);
  row(projectId, id);
  return serializeGit(project.repo_path, async () => {
    for (const t of threads(projectId, id)) { await closeSession(t.session_id); updateSession(t.session_id, { status: 'complete' }); }
    await removeReviewWorktrees(project.repo_path, id);
    queries.finishThreadsDeleteBranchReviewThreads(id);
    return { finished: true };
  });
}
