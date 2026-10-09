import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getDb } from '../../infrastructure/db/schema';
import { getProject } from '../projects';
import { CodeError } from '../code/files';
import { runGit, serializeGit } from '../code/git-write';
import { createSession, updateSession } from '../agent-sessions/sessions';
import { closeSession } from '../agent-sessions/acp-host';
import type { MrSession } from '../../models/mr-review';
interface Thread { id: string; review_id: string; head: string; path: string; side: string; line: number; session_id: string }
export function privateThreads(review: string): Thread[] {
  return getDb().prepare('SELECT * FROM mr_private_threads WHERE review_id=? ORDER BY rowid').all(review) as Thread[];
}
export function reviewWorkspace(sessionId: string): string {
  const row = getDb().prepare('SELECT w.path FROM mr_private_threads t JOIN mr_worktrees w ON w.review_id=t.review_id AND w.head=t.head WHERE t.session_id=? AND w.active=1').get(sessionId) as { path: string } | undefined;
  if (!row) throw new CodeError('Private MR review: discussion only, read-only; no publication or drafting GitLab comments', 409);
  return row.path;
}
export async function openPrivateThread(s: MrSession, ref: string, input: { path?: unknown; side?: unknown; line?: unknown; head?: unknown }) {
  const file = s.snapshot.files.find(f => f.new_path === input.path);
  if (!file || !['old','new'].includes(String(input.side)) || !Number.isSafeInteger(input.line) || Number(input.line) < 1 || input.head !== s.snapshot.version.head_commit_sha)
    throw new CodeError('Private MR review: discussion only, read-only; no publication or drafting GitLab comments');
  const project = getProject(s.project_id)!;
  if (!project.default_agent_id) throw new CodeError('Private MR review: discussion only, read-only; no publication or drafting GitLab comments');
  const head = s.snapshot.version.head_commit_sha;
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new CodeError('Invalid MR head');
  return serializeGit(project.repo_path, async () => {
    const db = getDb();
    const existing = privateThreads(s.id).find(t => t.head === head && t.path === input.path && t.side === input.side && t.line === input.line);
    if (existing) { reviewWorkspace(existing.session_id); return existing; }
    const location = path.join(os.tmpdir(), 'plangent-reviews', s.id, head);
    const workspace = db.prepare('SELECT path FROM mr_worktrees WHERE review_id=? AND head=? AND active=1').get(s.id, head);
    if (!workspace) {
      await fs.mkdir(path.dirname(location), { recursive: true });
      await runGit(project.repo_path, ['fetch','origin',ref]);
      // The version selected in the UI may predate the current MR ref. Never substitute its HEAD.
      await runGit(project.repo_path, ['cat-file','-e',head + '^{commit}']);
      await runGit(project.repo_path, ['worktree','add','--detach',location,head]);
      db.prepare('INSERT INTO mr_worktrees(review_id,head,path,active) VALUES (?,?,?,1) ON CONFLICT(review_id,head) DO UPDATE SET active=1,path=excluded.path').run(s.id,head,location);
    }
    const session = createSession({ project_id: s.project_id, agent_id: project.default_agent_id!, role: 'chat', policy: 'read-only', title: 'Приватно · !' + s.iid + ' · ' + file.new_path + ':' + input.line,
      metadata: { mr_private: true, briefing: 'Приватное обсуждение МР. Ты собеседник: объясняй код, не формулируй замечания для GitLab, ничего не публикуй, не меняй файлы или git. Весь код МР доступен в текущем worktree. Версия: ' + head + '. Строка: ' + input.side + ' ' + file.new_path + ':' + input.line + '. Diff:\n' + file.diff } });
    const thread = { id: session.id, review_id: s.id, head, path: file.new_path, side: String(input.side), line: Number(input.line), session_id: session.id };
    db.prepare('INSERT INTO mr_private_threads(id,review_id,head,path,side,line,session_id) VALUES (?,?,?,?,?,?,?)').run(thread.id,s.id,head,thread.path,thread.side,thread.line,session.id);
    return thread;
  });
}
export async function finishPrivateReview(s: MrSession) {
  const project = getProject(s.project_id)!;
  return serializeGit(project.repo_path, async () => {
    for (const t of privateThreads(s.id)) { await closeSession(t.session_id); updateSession(t.session_id, { status: 'complete' }); }
    const rows = getDb().prepare('SELECT path,head FROM mr_worktrees WHERE review_id=? AND active=1').all(s.id) as { path: string; head: string }[];
    for (const w of rows) {
      // Git removes only a registered clean worktree; never force or recursively delete a computed path.
      await runGit(project.repo_path, ['worktree','remove',w.path]);
      getDb().prepare('UPDATE mr_worktrees SET active=0 WHERE review_id=? AND head=?').run(s.id,w.head);
    }
    getDb().prepare('DELETE FROM mr_private_threads WHERE review_id=?').run(s.id);
    return { finished: true };
  });
}
