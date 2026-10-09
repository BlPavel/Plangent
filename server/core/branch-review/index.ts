import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getDb } from '../../infrastructure/db/schema';
import { getProject, effectiveGitSettings } from '../projects';
import { CodeError } from '../code/files';
import { fetchRepository, runGit, serializeGit } from '../code/git-write';
import { branches, repositoryInfo } from '../code/git';
import { createSession, updateSession } from '../agent-sessions/sessions';
import { closeSession } from '../agent-sessions/acp-host';
import { commitOf, fileAt, fileDiff, isAncestor, mergeBase, rangeCommits, rangeCount, rangeFiles, resolveRef, type ReviewFile } from './git-diff';

interface Row { id: string; project_id: string; branch: string; base: string; seen_head: string }
interface Thread { id: string; review_id: string; head: string; path: string; side: string; line: number; session_id: string }
const db = () => getDb();

function repo(projectId: string) {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project') throw new CodeError('Проект не найден', 404);
  return project;
}
function row(projectId: string, id: string): Row {
  const r = db().prepare('SELECT * FROM branch_reviews WHERE id=? AND project_id=?').get(id, projectId) as Row | undefined;
  if (!r) throw new CodeError('Ревью не найдено', 404);
  return r;
}
async function state(project: ReturnType<typeof repo>, r: Row) {
  const root = project.repo_path;
  const [head, base] = await Promise.all([resolveRef(root, r.branch), resolveRef(root, r.base)]);
  const headSha = await commitOf(root, head.ref), baseSha = await commitOf(root, base.ref);
  const from = await mergeBase(root, baseSha, headSha);
  return { root, head, base, headSha, from };
}
const viewedRows = (id: string) => db().prepare('SELECT path,sig FROM branch_review_viewed WHERE review_id=?').all(id) as { path: string; sig: string }[];

export async function listBranches(projectId: string) {
  const project = repo(projectId), root = project.repo_path;
  const [all, info] = await Promise.all([branches(root), repositoryInfo(root)]);
  const settings = effectiveGitSettings(projectId).values;
  const wanted = settings.mr_target_branch || settings.base_branch || 'main';
  const base = all.find(b => b.ref === 'refs/remotes/origin/' + wanted) ?? all.find(b => b.ref === 'refs/heads/' + wanted) ?? null;
  return { branches: all, current: info?.branch ?? null, default_base: base?.ref ?? null };
}
export async function fetchBranches(projectId: string) {
  await fetchRepository(repo(projectId).repo_path);
  return listBranches(projectId);
}
export async function openReview(projectId: string, input: { branch?: unknown; base?: unknown }) {
  const project = repo(projectId), root = project.repo_path;
  const head = await resolveRef(root, input.branch), base = await resolveRef(root, input.base);
  if (head.ref === base.ref) throw new CodeError('Выберите разные ветки');
  const existing = db().prepare('SELECT * FROM branch_reviews WHERE project_id=? AND branch=? AND base=?').get(projectId, head.ref, base.ref) as Row | undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) db().prepare('INSERT INTO branch_reviews(id,project_id,branch,base) VALUES (?,?,?,?)').run(id, projectId, head.ref, base.ref);
  return detail(projectId, id);
}
export async function detail(projectId: string, id: string) {
  const project = repo(projectId), r = row(projectId, id), s = await state(project, r);
  const [files, commits, count] = await Promise.all([rangeFiles(s.root, s.from, s.headSha), rangeCommits(s.root, s.from, s.headSha), rangeCount(s.root, s.from, s.headSha)]);
  const marks = new Map(viewedRows(id).map(v => [v.path, v.sig]));
  const moved = !!r.seen_head && r.seen_head !== s.headSha;
  const descends = moved && await isAncestor(s.root, r.seen_head, s.headSha);
  return {
    review: { id, project_id: projectId, branch: r.branch, base: r.base, branch_name: s.head.name, base_name: s.base.name, head: s.headSha, merge_base: s.from },
    files: files.map(f => ({ ...f, viewed: !marks.has(f.path) ? 'none' : marks.get(f.path) === f.sig ? 'viewed' : 'changed' })),
    commits, commit_count: count,
    new_commits: descends ? await rangeCount(s.root, r.seen_head, s.headSha) : 0,
    /** The branch was force-pushed since the last acknowledged state. */
    rewritten: moved && !descends,
  };
}
/** Manual update only: fetch, then recompute against the refreshed refs. */
export async function refreshReview(projectId: string, id: string) {
  row(projectId, id);
  await fetchRepository(repo(projectId).repo_path);
  return detail(projectId, id);
}
export async function acknowledge(projectId: string, id: string) {
  const s = await state(repo(projectId), row(projectId, id));
  db().prepare("UPDATE branch_reviews SET seen_head=?,updated_at=datetime('now') WHERE id=?").run(s.headSha, id);
  return detail(projectId, id);
}
async function findFile(projectId: string, id: string, p: unknown) {
  const s = await state(repo(projectId), row(projectId, id));
  const file = (await rangeFiles(s.root, s.from, s.headSha)).find(f => f.path === p);
  if (!file) throw new CodeError('Файл не найден в ревью', 404);
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
export async function setViewed(projectId: string, id: string, p: unknown, value: unknown) {
  const { file } = await findFile(projectId, id, p);
  if (value) db().prepare('INSERT INTO branch_review_viewed(review_id,path,sig) VALUES (?,?,?) ON CONFLICT(review_id,path) DO UPDATE SET sig=excluded.sig').run(id, file.path, file.sig);
  else db().prepare('DELETE FROM branch_review_viewed WHERE review_id=? AND path=?').run(id, file.path);
  return detail(projectId, id);
}

export function threads(projectId: string, id: string): Thread[] {
  row(projectId, id);
  return db().prepare('SELECT * FROM mr_private_threads WHERE review_id=? ORDER BY rowid').all(id) as Thread[];
}
const briefing = (r: Row, head: string, file: ReviewFile | undefined, line: number, side: string, text: string) =>
  'Ревью локальной ветки без изменения кода. Ты собеседник: объясняй код и отвечай на вопросы, не меняй файлы и git, не формулируй замечания для публикации. ' +
  'Код ветки доступен в текущей рабочей копии (коммит ' + head + '), сравнение с ' + r.base + '. ' +
  (file ? 'Контекст: ' + side + ' ' + file.path + ':' + line + '.\nDiff файла:\n' + text : 'Контекст: вся ветка, смотри git diff и git log в рабочей копии.');
/** A chat about the whole branch (no path) or about one line of one file. Code lives in a detached read-only worktree. */
export async function openThread(projectId: string, id: string, input: { path?: unknown; side?: unknown; line?: unknown }) {
  const project = repo(projectId), r = row(projectId, id);
  if (!project.default_agent_id) throw new CodeError('Выберите агента по умолчанию в настройках проекта', 409);
  const s = await state(project, r);
  const wholeBranch = input.path === undefined || input.path === '';
  const line = wholeBranch ? 0 : Number(input.line);
  if (!wholeBranch && (!['old', 'new'].includes(String(input.side)) || !Number.isSafeInteger(line) || line < 1)) throw new CodeError('Некорректная строка');
  const file = wholeBranch ? undefined : (await findFile(projectId, id, input.path)).file;
  const side = file ? String(input.side) : 'new', filePath = file?.path ?? '';
  return serializeGit(s.root, async () => {
    const existing = threads(projectId, id).find(t => t.head === s.headSha && t.path === filePath && t.side === side && t.line === line);
    if (existing) return existing;
    const location = path.join(os.tmpdir(), 'plangent-reviews', id, s.headSha);
    if (!db().prepare('SELECT 1 FROM mr_worktrees WHERE review_id=? AND head=? AND active=1').get(id, s.headSha)) {
      await fs.mkdir(path.dirname(location), { recursive: true });
      await runGit(s.root, ['worktree', 'add', '--detach', location, s.headSha]);
      db().prepare('INSERT INTO mr_worktrees(review_id,head,path,active) VALUES (?,?,?,1) ON CONFLICT(review_id,head) DO UPDATE SET active=1,path=excluded.path').run(id, s.headSha, location);
    }
    const text = file ? await fileDiff(s.root, s.from, s.headSha, file) : '';
    const session = createSession({ project_id: projectId, agent_id: project.default_agent_id!, role: 'chat', policy: 'read-only',
      title: 'Ревью · ' + s.head.name + (file ? ' · ' + file.path + ':' + line : ''),
      metadata: { mr_private: true, briefing: briefing(r, s.headSha, file, line, side, text) } });
    db().prepare('INSERT INTO mr_private_threads(id,review_id,head,path,side,line,session_id) VALUES (?,?,?,?,?,?,?)').run(session.id, id, s.headSha, filePath, side, line, session.id);
    return { id: session.id, review_id: id, head: s.headSha, path: filePath, side, line, session_id: session.id };
  });
}
/** Removes worktrees and closes agents; the review marks and the chat history stay. */
export async function finishThreads(projectId: string, id: string) {
  const project = repo(projectId);
  row(projectId, id);
  return serializeGit(project.repo_path, async () => {
    for (const t of threads(projectId, id)) { await closeSession(t.session_id); updateSession(t.session_id, { status: 'complete' }); }
    const rows = db().prepare('SELECT path,head FROM mr_worktrees WHERE review_id=? AND active=1').all(id) as { path: string; head: string }[];
    for (const w of rows) {
      // Only a registered worktree is removed by git; never delete a computed path ourselves.
      await runGit(project.repo_path, ['worktree', 'remove', w.path]);
      db().prepare('UPDATE mr_worktrees SET active=0 WHERE review_id=? AND head=?').run(id, w.head);
    }
    db().prepare('DELETE FROM mr_private_threads WHERE review_id=?').run(id);
    return { finished: true };
  });
}
