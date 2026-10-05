import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../../infrastructure/db/schema';
import { CodeError, codePath, readCodeFile } from '../code/files';
import { repositoryInfo, localBranches, localBranchHead, reviewCommitCount, oldFile, diffFile, treeChanges, snapshot } from '../code/git';
import type { RepositoryInfo } from '../code/git';
import type { CodeReview, CodeReviewItem, CreateCodeReviewItem, UpdateCodeReviewItem } from '../../models/code-review';
import { createReviewStore } from './store';
import { captureRound } from './rounds';
import type { AgentSession } from '../agent-sessions/types';
import { broadcast } from '../shared/events';
import { CODE_FIXER_PROTOCOL } from '../library/code-fixer-instruction';

type Draft = Omit<CreateCodeReviewItem, 'review_id' | 'round_id' | 'author' | 'status' | 'answer' | 'carried_from_item_id' | 'outdated'>;
type CloseMode = 'require_resolved' | 'carry' | 'close';
const unresolved = (item: CodeReviewItem) => ['draft', 'sent', 'needs_decision'].includes(item.status);
const projectLocks = new WeakMap<Database.Database, Map<string, Promise<unknown>>>();
const noGitHead = ''; // Non-null identity reserved for projects without Git; never a Git revision.
const missingHash = 'missing'; // Viewed mark of a file that is absent from the worktree (a deletion).

export function createReviewService(db: Database.Database = getDb(), dependencies: {
  repository?: typeof repositoryInfo;
  branches?: typeof localBranches;
  closeSession?: (id: string) => Promise<void>;
  startSession?: (id: string) => Promise<unknown>;
  sendPrompt?: (id: string, content: { type: 'text'; text: string }[]) => Promise<void>;
} = {}) {
  const store = createReviewStore(db);
  const repository = dependencies.repository ?? repositoryInfo;
  const branches = dependencies.branches ?? localBranches;
  const locks = projectLocks.get(db) ?? new Map<string, Promise<unknown>>();
  projectLocks.set(db, locks);
  // All lifecycle mutations for a project share a queue, including first-draft creation.
  async function exclusive<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(projectId) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(action);
    locks.set(projectId, work);
    try { return await work; } finally { if (locks.get(projectId) === work) locks.delete(projectId); }
  }
  function project(projectId: string) {
    const row = db.prepare("SELECT id,repo_path,kind FROM projects WHERE id=?").get(projectId) as
      { id: string; repo_path: string; kind: string } | undefined;
    if (!row || row.kind !== 'project') throw new CodeError('Project not found', 404);
    return row;
  }
  function reviewFor(projectId: string, id: string) {
    project(projectId);
    const review = store.getReview(id);
    if (!review || review.project_id !== projectId) throw new CodeError('Review not found', 404);
    return review;
  }
  function matches(review: CodeReview, info: RepositoryInfo | null) {
    return info ? review.branch === info.branch && (info.branch !== null || review.head_commit === info.head)
      : review.branch === null && review.head_commit === noGitHead;
  }
  async function context(projectId: string) {
    const root = project(projectId).repo_path;
    const info = await repository(root);
    if (info) {
      const existing = new Set(await branches(root));
      for (const review of store.listReviews(projectId, 'open')) {
        if (matches(review, info)) {
          db.prepare('UPDATE code_review SET head_last=? WHERE id=?').run(info.head ?? noGitHead, review.id);
        } else if (review.branch !== null && !existing.has(review.branch) && review.branch !== info.branch) {
          store.updateReview(review.id, { status: 'abandoned', head_end: review.head_last || review.head_start });
          // Abandoned means a missing branch, not a completed review.
          db.prepare('UPDATE code_review SET closed_at=NULL WHERE id=?').run(review.id);
        }
      }
    }
    return { root, info };
  }
  function editable(review: CodeReview, info: RepositoryInfo | null) {
    if (review.status !== 'open' || !matches(review, info)) throw new CodeError('Review is read-only', 409);
  }
  function filePath(root: string, file: string) {
    return path.relative(codePath(root, '', true), codePath(root, file)).replace(/\\/g, '/');
  }
  function validateDraft(root: string, info: RepositoryInfo | null, data: Draft): Draft {
    if (!data || typeof data !== 'object' || !['line', 'file', 'general'].includes(data.scope)
      || !['fix', 'question'].includes(data.kind) || typeof data.text !== 'string' || !data.text.trim())
      throw new CodeError('Invalid review item');
    if (data.refs !== undefined && (!Array.isArray(data.refs) || data.refs.some(ref => typeof ref !== 'string')))
      throw new CodeError('Invalid refs');
    if (data.side !== undefined && data.side !== 'new' && data.side !== 'old') throw new CodeError('Invalid side');
    if (data.code_snippet !== undefined && typeof data.code_snippet !== 'string') throw new CodeError('Invalid snippet');
    if (!info && data.scope !== 'file' && data.scope !== 'general') throw new CodeError('Line items require Git');
    if (!info && data.side === 'old') throw new CodeError('Old-side items require Git');
    if (data.scope === 'general') {
      if (data.file != null || data.line_start != null || data.line_end != null) throw new CodeError('Invalid general item');
    } else {
      if (typeof data.file !== 'string') throw new CodeError('File required');
      data = { ...data, file: filePath(root, data.file) };
      if (data.scope === 'file' && (data.line_start != null || data.line_end != null)) throw new CodeError('Invalid file item');
      if (data.scope === 'line' && (!Number.isSafeInteger(data.line_start) || data.line_start! < 1
        || (data.line_end != null && (!Number.isSafeInteger(data.line_end) || data.line_end < data.line_start!))))
        throw new CodeError('Invalid line range');
    }
    return data;
  }
  async function snippet(root: string, info: RepositoryInfo | null, data: Draft): Promise<string> {
    if (data.scope !== 'line') return data.code_snippet ?? '';
    // The server captures the original selection rather than trusting a client-provided snippet.
    const content = data.side === 'old'
      ? await oldFile(root, data.file!, info?.head ?? 'HEAD')
      : (await readCodeFile(root, data.file!)).content;
    if (content === undefined) throw new CodeError('Line items require a text file');
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const end = data.line_end ?? data.line_start!;
    if (end > lines.length) throw new CodeError('Line range outside file');
    const result = lines.slice(data.line_start! - 1, end).join('\n');
    if (!result) throw new CodeError('Empty line snippet');
    return result;
  }
  async function ensureSame(root: string, info: RepositoryInfo | null) {
    if (JSON.stringify(await repository(root)) !== JSON.stringify(info)) throw new CodeError('Repository changed; retry', 409);
  }
  function createCurrent(projectId: string, info: RepositoryInfo | null, origin: 'project' | 'task', originId: string) {
    return store.createReview({ project_id: projectId, branch: info?.branch ?? null,
      head_commit: info?.branch ? null : info?.head ?? noGitHead,
      head_start: info?.head ?? noGitHead, origin, origin_id: originId });
  }
  function openCurrent(projectId: string, info: RepositoryInfo | null) {
    return store.getOpenReview(projectId, info?.branch ?? null, info?.head ?? noGitHead);
  }
  function checkOrigin(projectId: string, origin: string, originId: string) {
    if (origin !== 'project' && origin !== 'task') throw new CodeError('Invalid origin');
    if (origin === 'project' && originId !== projectId) throw new CodeError('Invalid project origin');
    if (origin === 'task' && !db.prepare('SELECT id FROM tasks WHERE id=? AND project_id=?').get(originId, projectId))
      throw new CodeError('Task not found', 404);
  }
  async function addDraft(projectId: string, input: Draft, origin: 'project' | 'task' = 'project', originId = projectId) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      const data = validateDraft(root, info, input);
      checkOrigin(projectId, origin, originId);
      const code_snippet = await snippet(root, info, data);
      await ensureSame(root, info);
      return db.transaction(() => {
        const review = openCurrent(projectId, info) ?? createCurrent(projectId, info, origin, originId);
        const item = store.createItem({ ...data, review_id: review.id, round_id: null, author: 'developer',
          status: 'draft', answer: null, outdated: false, carried_from_item_id: null, code_snippet });
        return { review, item };
      })();
    });
  }
  function itemFor(reviewId: string, itemId: string) {
    const item = store.getItem(itemId);
    if (!item || item.review_id !== reviewId) throw new CodeError('Item not found', 404);
    return item;
  }
  async function updateDraft(projectId: string, reviewId: string, itemId: string, patch: UpdateCodeReviewItem) {
    return exclusive(projectId, async () => {
      const review = reviewFor(projectId, reviewId);
      const { root, info } = await context(projectId);
      editable(review, info);
      const item = itemFor(reviewId, itemId);
      if (item.status !== 'draft' || item.round_id !== null) throw new CodeError('Only drafts can be edited', 409);
      const allowed = ['scope', 'file', 'line_start', 'line_end', 'side', 'kind', 'text', 'refs'];
      if (!patch || Object.keys(patch).some(key => !allowed.includes(key))) throw new CodeError('Invalid draft update');
      const data = validateDraft(root, info, { ...item, ...patch });
      const locationChanged = ['scope', 'file', 'line_start', 'line_end', 'side'].some(key => key in patch);
      const code_snippet = locationChanged ? await snippet(root, info, data) : item.code_snippet;
      await ensureSame(root, info);
      return store.updateItem(itemId, { ...patch, file: data.file, code_snippet, outdated: locationChanged ? false : item.outdated });
    });
  }
  async function removeItem(projectId: string, reviewId: string, itemId: string) {
    return exclusive(projectId, async () => {
      const { info } = await context(projectId);
      editable(reviewFor(projectId, reviewId), info);
      itemFor(reviewId, itemId);
      return store.deleteItem(itemId);
    });
  }
  async function makeGeneral(projectId: string, reviewId: string, itemId: string) {
    return exclusive(projectId, async () => {
      const { info } = await context(projectId);
      editable(reviewFor(projectId, reviewId), info);
      const item = itemFor(reviewId, itemId);
      if (!item.outdated) throw new CodeError('Item is not outdated', 409);
      return store.updateItem(itemId, { scope: 'general', file: null, line_start: null, line_end: null, outdated: false });
    });
  }
  function activeSessions(reviewId: string) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_sessions'").get()) return [];
    return store.listRounds(reviewId).flatMap(round => round.session_id
      ? db.prepare("SELECT id,status FROM agent_sessions WHERE id=? AND status IN ('starting','thinking','waiting')").all(round.session_id)
      : []) as { id: string; status: string }[];
  }
  function sessionFor(id: string): AgentSession {
    const row = db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id) as
      (Omit<AgentSession, 'metadata' | 'step_ids'> & { metadata: string; step_ids: string }) | undefined;
    if (!row) throw new CodeError('Session not found', 404);
    return { ...row, metadata: JSON.parse(row.metadata), step_ids: JSON.parse(row.step_ids) };
  }
  function boundReview(session: AgentSession) {
    if (session.role !== 'code-fixer') throw new CodeError('Code fixer role required', 403);
    const row = db.prepare('SELECT review_id FROM code_review_round WHERE session_id=? ORDER BY n DESC LIMIT 1')
      .get(session.id) as { review_id: string } | undefined;
    if (!row) throw new CodeError('Chat is not bound to a review', 403);
    return reviewFor(session.project_id, row.review_id);
  }
  function notify(reviewId: string, item?: CodeReviewItem) {
    const review = store.getReview(reviewId)!;
    const items = store.listItems(reviewId);
    const attention = items.filter(item => item.status === 'needs_decision');
    broadcast({ type: 'code_review_updated', projectId: review.project_id, reviewId, item,
      attention: attention.length, unresolved: items.filter(unresolved).length });
    if (item?.status === 'needs_decision') broadcast({ type: 'code_review_needs_decision',
      projectId: review.project_id, reviewId, itemId: item.id, reason: item.answer });
  }
  function attention(projectId: string) {
    project(projectId);
    return store.listReviews(projectId, 'open').flatMap(review => {
      const items = store.listItems(review.id).filter(item => item.status === 'needs_decision');
      return items.length ? [{ project_id: projectId, review_id: review.id, origin: review.origin,
        origin_id: review.origin_id, count: items.length, items }] : [];
    });
  }
  async function sendRound(projectId: string, reviewId: string, sessionId: string, note = '', itemIds?: string[]) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      const review = reviewFor(projectId, reviewId);
      editable(review, info);
      if (activeSessions(reviewId).length) throw new CodeError('Agent is working', 409);
      let session = sessionFor(sessionId);
      if (session.role !== 'code-fixer' || session.project_id !== projectId)
        throw new CodeError('Choose a code fixer chat in this project', 403);
      if (db.prepare('SELECT 1 FROM code_review_round WHERE session_id=? AND review_id<>?').get(sessionId, reviewId))
        throw new CodeError('Chat belongs to another review', 409);
      if (session.status === 'starting') {
        await (dependencies.startSession ?? (await import('../agent-sessions/acp-host')).startSession)(sessionId);
        session = sessionFor(sessionId);
      }
      if (!['ready', 'complete', 'error'].includes(session.status)) throw new CodeError('Agent is working', 409);
      const sent = await captureRound(db, review, session, root, async () => {
        await ensureSame(root, info);
        if (activeSessions(reviewId).length || !['ready', 'complete', 'error'].includes(sessionFor(sessionId).status))
          throw new CodeError('Agent is working', 409);
      }, itemIds);
      // Name a new chat after the review instead of the round announcement.
      db.prepare("UPDATE agent_sessions SET title=? WHERE id=? AND title='Новый чат'").run(`Доработка · ревью #${review.number}`, sessionId);
      try {
        await (dependencies.sendPrompt ?? (await import('../agent-sessions/acp-host')).sendPrompt)(
          sessionId, [{ type: 'text', text: note.trim() ? `${sent.text}\n\nКомментарий разработчика: ${note.trim().slice(0, 4000)}` : sent.text }]);
      } catch (error) {
        db.transaction(() => {
          // Restore what each item was before the round, not just drafts.
          for (const item of sent.previous) store.updateItem(item.id, { status: item.status, round_id: item.round_id, kind: item.kind });
          store.deleteRound(sent.round.id);
        })();
        notify(reviewId);
        throw error;
      }
      notify(reviewId);
      return { round: sent.round, items: sent.items };
    });
  }
  /** What get_review gives the code fixer: the rules, its pending items, and the rest of the review as context. */
  async function getAgentReview(session: AgentSession) {
    const review = boundReview(session);
    const rounds = store.listRounds(review.id);
    const mine = new Set(rounds.filter(round => round.session_id === session.id).map(round => round.id));
    const roundOf = new Map(rounds.map(round => [round.id, round.n]));
    const brief = (item: CodeReviewItem) => ({ id: item.id, round: item.round_id ? roundOf.get(item.round_id) : null,
      kind: item.kind, scope: item.scope, file: item.file, line_start: item.line_start, line_end: item.line_end,
      side: item.side, text: item.text, refs: item.refs, code_snippet: item.code_snippet, status: item.status,
      answer: item.answer, outdated: item.outdated });
    const sent = store.listItems(review.id).filter(item => item.round_id);
    const assigned = (item: CodeReviewItem) => mine.has(item.round_id!) && item.status === 'sent';
    return { protocol: CODE_FIXER_PROTOCOL,
      review: { id: review.id, number: review.number, branch: review.branch },
      assigned: sent.filter(assigned).map(brief),
      history: sent.filter(item => !assigned(item)).map(brief) };
  }
  async function resolveItem(session: AgentSession, itemId: string, status: string, answer: string) {
    return exclusive(session.project_id, async () => {
      const review = boundReview(session);
      const { info } = await context(session.project_id);
      editable(review, info);
      const item = itemFor(review.id, itemId);
      const round = item.round_id ? store.getRound(item.round_id) : null;
      if (!round || round.session_id !== session.id) throw new CodeError('Item belongs to another chat', 403);
      if (!['done', 'answered', 'needs_decision'].includes(status) || !answer.trim())
        throw new CodeError('Invalid resolution');
      if (!['sent', 'answered', 'needs_decision'].includes(item.status)) throw new CodeError('Item is not pending', 409);
      if (status === 'answered' && item.kind !== 'question') throw new CodeError('Only questions can be answered');
      if (status === 'done' && item.kind === 'question') {
        const resolution = db.prepare("SELECT seq FROM agent_session_events WHERE session_id=? AND type='resolve_review_item' AND json_extract(payload,'$.id')=? ORDER BY seq DESC LIMIT 1")
          .get(session.id, item.id) as { seq: number } | undefined;
        const discussed = resolution && db.prepare("SELECT 1 FROM agent_session_events WHERE session_id=? AND type='user' AND seq>?")
          .get(session.id, resolution.seq);
        if (!discussed || !answer.includes('по итогам обсуждения'))
          throw new CodeError('Answer the question first; changes require explicit developer agreement in chat and the discussion note', 409);
      }
      const updated = store.updateItem(item.id, { status: status as CodeReviewItem['status'], answer })!;
      notify(review.id, updated);
      return updated;
    });
  }
  async function decideItem(projectId: string, reviewId: string, itemId: string, decision: string) {
    return exclusive(projectId, async () => {
      const { info } = await context(projectId);
      editable(reviewFor(projectId, reviewId), info);
      const item = itemFor(reviewId, itemId);
      if (item.status !== 'needs_decision') throw new CodeError('Item does not need a decision', 409);
      if (!['agree', 'insist'].includes(decision)) throw new CodeError('Invalid decision');
      if (decision === 'agree') {
        const updated = store.updateItem(item.id, { status: 'rejected' })!;
        notify(reviewId, updated);
        return updated;
      }
      const round = item.round_id ? store.getRound(item.round_id) : null;
      if (!round?.session_id) throw new CodeError('Review chat was deleted; create a new draft to resend', 409);
      if (activeSessions(reviewId).length) throw new CodeError('Agent is working', 409);
      const updated = store.updateItem(item.id, { status: 'sent' })!;
      try {
        await (dependencies.sendPrompt ?? (await import('../agent-sessions/acp-host')).sendPrompt)(
          round.session_id, [{ type: 'text', text: `Сделай как в замечании: разработчик настаивает на пункте ${item.id}, он снова в assigned у get_review.` }]);
      } catch (error) {
        store.updateItem(item.id, { status: 'needs_decision' });
        throw error;
      }
      notify(reviewId, updated);
      return updated;
    });
  }
  async function finish(projectId: string, reviewId: string, mode: CloseMode = 'require_resolved') {
    return exclusive(projectId, async () => {
      if (!['require_resolved', 'carry', 'close'].includes(mode)) throw new CodeError('Invalid close mode');
      const { root, info } = await context(projectId);
      const review = reviewFor(projectId, reviewId);
      if (review.status === 'closed') throw new CodeError('Review already closed', 409);
      if (review.status !== 'abandoned') editable(review, info);
      if (activeSessions(reviewId).length) throw new CodeError('Agent is working', 409);
      const pending = store.listItems(reviewId).filter(unresolved);
      if (pending.length && mode === 'require_resolved') throw new CodeError('Unresolved review items', 409);
      if (mode === 'carry' && review.status === 'abandoned') throw new CodeError('Cannot carry from a missing branch', 409);
      await ensureSame(root, info);
      return db.transaction(() => {
        // A deleted branch cannot be resolved: retain the last known review endpoint.
        const closed = store.updateReview(reviewId, { status: 'closed',
          head_end: review.status === 'abandoned' ? review.head_last || review.head_start : info?.head ?? noGitHead })!;
        let next: CodeReview | null = null;
        if (mode === 'carry' && pending.length) {
          next = createCurrent(projectId, info, review.origin, review.origin_id);
          for (const item of pending) store.createItem({ ...item, review_id: next.id, round_id: null,
            author: 'developer', status: 'draft', answer: null, carried_from_item_id: item.id });
        } else if (mode === 'close') {
          for (const item of pending) store.updateItem(item.id, { status: 'rejected' });
        }
        return { review: closed, next_review: next };
      })();
    });
  }
  async function contentHash(root: string, file: string): Promise<string | null> {
    // Hash all regular files, including binary/large files, without loading them in memory.
    let full: string;
    try { full = codePath(root, file); } catch (error) {
      if (error instanceof CodeError) return null; // A replaced external symlink invalidates a prior mark.
      throw error;
    }
    const handle = await fs.open(full, 'r').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!handle) return null;
    try {
      if (!(await handle.stat()).isFile()) throw new CodeError('Not a regular file');
      const digest = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
      return digest.digest('hex');
    } finally { await handle.close(); }
  }
  async function viewedFiles(root: string, reviewId: string) {
    return Promise.all(store.listFileViews(reviewId).map(async view => {
      const current_hash = (await contentHash(root, view.path)) ?? missingHash;
      if (current_hash !== view.content_hash && !view.invalidated)
        db.prepare('UPDATE code_review_file_view SET invalidated=1 WHERE review_id=? AND path=?').run(reviewId, view.path);
      const changed = view.invalidated || current_hash !== view.content_hash;
      return { ...view, invalidated: changed, current_hash, viewed: !changed, changed_after_view: changed };
    }));
  }
  /** Hash of the file to remember; a deleted file (still in HEAD) is viewable too. */
  async function viewedHash(root: string, info: RepositoryInfo, rel: string) {
    const hash = await contentHash(root, rel);
    if (hash !== null) return hash;
    try { await oldFile(root, rel, info.head ?? 'HEAD'); } catch { throw new CodeError('File not found', 404); }
    return missingHash;
  }
  async function markViewed(projectId: string, reviewId: string, file: string, viewed: boolean) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      editable(reviewFor(projectId, reviewId), info);
      if (!info) throw new CodeError('Viewed files require Git');
      const rel = filePath(root, file);
      if (!viewed) { store.deleteFileView(reviewId, rel); return null; }
      const content_hash = await viewedHash(root, info, rel);
      await ensureSame(root, info);
      return store.markFileViewed(reviewId, rel, content_hash);
    });
  }
  /** «Просмотрено» before any remark: the first mark opens the branch's review, like the first draft does. */
  async function markViewedCurrent(projectId: string, file: string, viewed: boolean, origin: 'project' | 'task' = 'project', originId = projectId) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      if (!info) throw new CodeError('Viewed files require Git');
      checkOrigin(projectId, origin, originId);
      const rel = filePath(root, file);
      const existing = openCurrent(projectId, info);
      if (!viewed) {
        if (existing) store.deleteFileView(existing.id, rel);
        return { review: existing ?? null, view: null };
      }
      const content_hash = await viewedHash(root, info, rel);
      await ensureSame(root, info);
      return db.transaction(() => {
        const review = existing ?? createCurrent(projectId, info, origin, originId);
        return { review, view: store.markFileViewed(review.id, rel, content_hash) };
      })();
    });
  }
  async function relocate(review: CodeReview, file: string, content: string | null, side: 'new' | 'old') {
    const lines = content?.replace(/\r\n/g, '\n').split('\n') ?? [];
    for (const item of store.listItems(review.id).filter(item => item.scope === 'line' && item.file === file && item.side === side)) {
      const selected = item.code_snippet.replace(/\r\n/g, '\n').split('\n');
      const matchesAt = (at: number) => item.code_snippet.length > 0
        && selected.every((line, offset) => lines[at + offset] === line);
      const original = item.line_start! - 1;
      const found = matchesAt(original) ? original : lines.findIndex((_, at) => matchesAt(at));
      if (found < 0) {
        if (!item.outdated) store.updateItem(item.id, { outdated: true });
      } else if (item.outdated || found !== original) {
        store.updateItem(item.id, { line_start: found + 1, line_end: found + selected.length, outdated: false });
      }
    }
  }
  async function openFile(projectId: string, reviewId: string, file: string, side: 'new' | 'old' = 'new') {
    return exclusive(projectId, async () => {
      if (side !== 'new' && side !== 'old') throw new CodeError('Invalid side');
      const { root, info } = await context(projectId);
      const review = reviewFor(projectId, reviewId);
      const rel = filePath(root, file);
      // Historical/paused reviews retain their saved anchors and are never rewritten.
      if (review.status === 'open' && matches(review, info)) {
        let content: string | null = null;
        try { content = side === 'old' ? await oldFile(root, rel, info?.head ?? 'HEAD')
          : (await readCodeFile(root, rel)).content ?? null; }
        catch (error) {
          if (!(error instanceof CodeError && error.status === 404) && !(side === 'old' && (error as { code?: number }).code)) throw error;
        }
        await ensureSame(root, info);
        await relocate(review, rel, content, side);
        await viewedFiles(root, reviewId);
      }
      return store.listItems(reviewId).filter(item => item.file === rel && item.side === side);
    });
  }
  async function detail(projectId: string, reviewId: string) {
    const review = reviewFor(projectId, reviewId);
    const rounds = store.listRounds(reviewId);
    const chats = rounds.map(round => {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_session_events'").get();
      const events = exists && round.session_id
        ? (db.prepare('SELECT seq,type,payload,created_at FROM agent_session_events WHERE session_id=? ORDER BY seq').all(round.session_id) as { seq: number; type: string; payload: string; created_at: string }[]).map(event => ({ ...event, payload: JSON.parse(event.payload) }))
        : [];
      return { session_id: round.session_id, events };
    });
    const info = await repository(project(projectId).repo_path);
    return { review, read_only: review.status !== 'open' || !matches(review, info),
      items: store.listItems(reviewId), rounds, chats, file_views: store.listFileViews(reviewId) };
  }
  async function current(projectId: string) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      const review = openCurrent(projectId, info);
      const other_reviews = store.listReviews(projectId, 'open').filter(row => row.id !== review?.id);
      const running_other_reviews = other_reviews.filter(row => activeSessions(row.id).length > 0);
      const items = review ? store.listItems(review.id) : [];
      const commits = review?.head_start && info?.head
        ? await reviewCommitCount(root, review.head_start, info.head).catch(() => null) : null;
      return { repository: info, review, items, rounds: review ? store.listRounds(review.id) : [],
        summary: review ? { head_start: review.head_start, head_current: info?.head ?? null, commits,
          rounds: store.listRounds(review.id).length, items: items.length, unresolved: items.filter(unresolved).length } : null,
        file_views: review && info ? await viewedFiles(root, review.id) : [], other_reviews, running_other_reviews,
        agent_working: review ? activeSessions(review.id).length > 0 : false,
        attention: items.filter(item => item.status === 'needs_decision').length,
        head_changed: !!review && review.head_start !== (info?.head ?? noGitHead) };
    });
  }
  async function history(projectId: string) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      return Promise.all(store.listReviews(projectId).map(async review => {
        const items = store.listItems(review.id);
        const end = review.head_end || review.head_last;
        const commits = review.head_start && end ? await reviewCommitCount(root, review.head_start, end).catch(() => null) : null;
        return { ...review, read_only: review.status !== 'open' || !matches(review, info), commits,
          rounds: store.listRounds(review.id).length, items: items.length,
          resolved: items.filter(item => !unresolved(item)).length, unresolved: items.filter(unresolved).length };
      }));
    });
  }
  async function reviewEnd(root: string, info: RepositoryInfo | null, review: CodeReview) {
    if (!review.head_start) throw new CodeError('Review has no Git base');
    const end = review.status === 'closed' || review.status === 'abandoned' ? review.head_end
      : matches(review, info) ? info?.head
      : review.branch ? await localBranchHead(root, review.branch) : review.head_commit;
    if (!end) throw new CodeError('Review endpoint unavailable', 409);
    return end;
  }
  async function reviewDiff(projectId: string, reviewId: string, file: string) {
    const { root, info } = await context(projectId);
    const review = reviewFor(projectId, reviewId);
    return diffFile(root, filePath(root, file), { base: review.head_start, end: await reviewEnd(root, info, review) });
  }
  /**
   * Files of a comparison base other than HEAD, as two endpoints the per-file diff accepts:
   * «review» is everything that entered the review (head_start → its end), «agent» is the worktree now
   * against the snapshot of a round (the last one by default), i.e. what the agent changed after it.
   */
  async function baseChanges(projectId: string, reviewId: string, base: 'review' | 'agent', roundId?: string) {
    return exclusive(projectId, async () => {
      const { root, info } = await context(projectId);
      const review = reviewFor(projectId, reviewId);
      if (base === 'review') {
        const end = await reviewEnd(root, info, review);
        return { base: review.head_start, end, ...await treeChanges(root, review.head_start, end) };
      }
      if (base !== 'agent') throw new CodeError('Invalid base');
      editable(review, info);
      const rounds = store.listRounds(reviewId).filter(round => round.snapshot_tree);
      const round = roundId ? rounds.find(candidate => candidate.id === roundId) : rounds[rounds.length - 1];
      if (!round) throw new CodeError('Round not found', 404);
      const end = await snapshot(root);
      if (!end) throw new CodeError('Review has no Git base');
      await ensureSame(root, info);
      return { base: round.snapshot_tree, end, ...await treeChanges(root, round.snapshot_tree, end) };
    });
  }
  async function removeReview(projectId: string, reviewId: string) {
    return exclusive(projectId, async () => {
      reviewFor(projectId, reviewId); // Explicit review deletion is allowed from history, including other branches.
      const sessions = [...new Set(store.listRounds(reviewId).map(round => round.session_id).filter((id): id is string => !!id))];
      const owned = sessions.filter(id => !db.prepare('SELECT 1 FROM code_review_round WHERE session_id=? AND review_id<>?').get(id, reviewId));
      const sessionTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_sessions'").get();
      for (const id of owned) {
        if (sessionTable && db.prepare('SELECT 1 FROM agent_sessions WHERE id=?').get(id)) {
          if (dependencies.closeSession) await dependencies.closeSession(id);
          else await (await import('../agent-sessions/acp-host')).closeSession(id);
        }
      }
      return db.transaction(() => {
        store.deleteReview(reviewId);
        if (sessionTable) for (const id of owned) db.prepare('DELETE FROM agent_sessions WHERE id=?').run(id);
        return true;
      })();
    });
  }
  return { addDraft, updateDraft, removeItem, makeGeneral, finish, markViewed, openFile, current,
    history, detail, reviewDiff, baseChanges, removeReview, markViewedCurrent, sendRound, getAgentReview, resolveItem, decideItem, attention };
}

let service: ReturnType<typeof createReviewService> | undefined;
export const reviews = () => service ??= createReviewService();
