import { rootForWorkspace } from '../workspaces/roots';
import { getWorkspace } from '../workspaces/store';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';
import { CodeError, codePath } from '../code/files';
import { conflictedFiles, gitOperation, type GitOperationState } from '../code/git';
import { runGit } from '../code/git-write';
import { getProject, conflictAgent } from '../projects';
import { getAgent } from '../agents';
import { createSession, getSession, updateSession } from '../agent-sessions/sessions';
import { sendPrompt, cancelSession, closeSession } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';

/**
 * The developer runs merge/rebase themselves; when it stops on conflicts, an agent edits the conflicted files.
 * Git stays with the developer: they check the result, stage it and continue or abort the operation.
 */
const PROTOCOL = [
  'Ты разрешаешь конфликты merge/rebase, который разработчик запустил сам. Git ты не меняешь: никаких add, commit, rebase --continue/--abort, checkout, merge. Это делает разработчик, когда проверит твою работу.',
  'Читать версии файла: git show :1:<путь> (общий предок), :2:<путь> (ours), :3:<путь> (theirs); также git log и git diff. Какая сторона чья — в sides. При rebase стороны перевёрнуты: ours — то, на что переносят ветку (чужие изменения), theirs — переносимый коммит разработчика.',
  'Для каждого файла пойми, зачем меняла каждая сторона, и объедини так, чтобы сохранились обе правки. Не бери сторону целиком, если обе меняли по делу. Убери все маркеры <<<<<<< ||||||| ======= >>>>>>>.',
  'Править можно только конфликтные файлы. Команды (установка зависимостей, сборка, тесты, генерация) не запускай: если что-то нужно выполнить, например пересобрать lock-файл, скажи об этом в итоге.',
  'По каждому файлу вызови report_conflict_file. outcome resolved — файл исправлен (Plangent проверит, что маркеров не осталось), в text коротко: какой конфликт и как разрешён. ' +
    'Не пиши, что делать дальше (проверить, git add, continue) — разработчик это знает. ' +
    'question — не уверен, как объединить: не угадывай, оставь спорные места с маркерами и задай вопрос в text. recommend — правкой текста не решить (удалён с одной стороны, бинарный, lock-файл): в text — что советуешь сделать.',
  'Ответы разработчика приходят в answers; учти их и сообщи по этим файлам заново. Итог в чат не пиши: всё нужное — в report_conflict_file. Пиши по-русски.',
];
const CODES: Record<string, string> = {
  UU: 'изменён с обеих сторон', AA: 'добавлен с обеих сторон', DD: 'удалён с обеих сторон',
  DU: 'удалён в ours, изменён в theirs', UD: 'изменён в ours, удалён в theirs', AU: 'добавлен только в ours', UA: 'добавлен только в theirs',
};
const OUTCOMES = ['resolved', 'question', 'recommend'] as const;
type Outcome = typeof OUTCOMES[number];
interface ResolutionRow { id: string; project_id: string; operation_id: string; session_id: string; closed: number }
interface FileRow { resolution_id: string; step: string; path: string; outcome: Outcome; text: string; answer: string; answer_sent: number; updated_at: string }

const db = () => getDb();
/** One stop of the operation: every commit of a rebase brings its own conflicts. */
const stepOf = (operation: GitOperationState) => operation.commit?.sha ?? operation.kind;
const changed = (projectId: string) => broadcast({ type: 'conflicts:changed', projectId });

function root(projectId: string, workspaceId?: string): string {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
  return rootForWorkspace(projectId, workspaceId);
}
function openResolution(projectId: string, workspaceId?: string): ResolutionRow | undefined {
  return db().prepare("SELECT r.* FROM conflict_resolutions r JOIN agent_sessions s ON s.id=r.session_id WHERE r.project_id=? AND r.closed=0 AND coalesce(json_extract(s.metadata,'$.workspace_id'),'')=? ORDER BY r.rowid DESC LIMIT 1").get(projectId, workspaceId ?? '') as ResolutionRow | undefined;
}
/** The operation ended (continued or aborted) or another one began: the agent of the old one is not needed any more. */
async function close(resolution: ResolutionRow) {
  db().prepare('UPDATE conflict_resolutions SET closed=1 WHERE id=?').run(resolution.id);
  await closeSession(resolution.session_id).catch(() => undefined);
  try { updateSession(resolution.session_id, { status: 'complete', reason: '' }); } catch { /* the chat was deleted */ }
}
async function current(projectId: string, workspaceId?: string) {
  const repo = root(projectId, workspaceId);
  const operation = await gitOperation(repo);
  let resolution = openResolution(projectId, workspaceId);
  if (resolution && resolution.operation_id !== operation?.id) { await close(resolution); resolution = undefined; changed(projectId); }
  return { repo, operation, resolution };
}

/** What the Код tab shows: the operation, its conflicted files with the agent's notes for this stop, and the agent's state. */
export async function conflictState(projectId: string, workspaceId?: string) {
  const { repo, operation, resolution } = await current(projectId, workspaceId);
  if (!operation) return { operation: null, files: [], session: null };
  const step = stepOf(operation);
  const conflicts = await conflictedFiles(repo);
  const notes = resolution ? db().prepare('SELECT * FROM conflict_files WHERE resolution_id=? AND step=? ORDER BY path').all(resolution.id, step) as FileRow[] : [];
  const paths = [...new Set([...conflicts.map(c => c.path), ...notes.map(n => n.path)])].sort();
  const files = paths.map(file => {
    const conflict = conflicts.find(c => c.path === file), note = notes.find(n => n.path === file);
    return { path: file, code: conflict?.code ?? '', conflicted: !!conflict,
      note: note ? { outcome: note.outcome, text: note.text, answer: note.answer, answer_sent: !!note.answer_sent } : null };
  });
  let session: { id: string; status: string; reason: string } | null = null;
  if (resolution) { try { const s = getSession(resolution.session_id); session = { id: s.id, status: s.status, reason: s.reason }; } catch { /* deleted */ } }
  return { operation, files, session };
}

/**
 * «Разрешить с агентом», «Отправить ответы» and «Попросить переделать»: one turn of the agent over the current conflicts.
 * `answers` — the developer's replies to the agent's questions, by file.
 */
export async function resolveConflicts(projectId: string, input: { note?: unknown; answers?: unknown } = {}, workspaceId?: string) {
  const { repo, operation, resolution: open } = await current(projectId, workspaceId);
  if (!operation) throw new CodeError('Нет незавершённого merge или rebase', 409);
  const step = stepOf(operation);
  let resolution = open;
  if (resolution) {
    const status = (() => { try { return getSession(resolution.session_id).status; } catch { return 'gone'; } })();
    if (['starting', 'thinking', 'waiting'].includes(status)) throw new CodeError('Агент работает: дождитесь конца ответа', 409);
    if (status === 'gone') { await close(resolution); resolution = undefined; }
  }
  const replies = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)
    ? Object.entries(input.answers as Record<string, unknown>).filter(([, text]) => typeof text === 'string' && text.trim()) : [];
  if (replies.length) {
    if (!resolution) throw new CodeError('Агент ещё не разбирал конфликты', 409);
    const save = db().prepare("UPDATE conflict_files SET answer=?,answer_sent=0 WHERE resolution_id=? AND step=? AND path=? AND outcome='question'");
    db().transaction(() => {
      for (const [file, text] of replies)
        if (!save.run(String(text).trim().slice(0, 20000), resolution!.id, step, file).changes) throw new CodeError('Агент не спрашивал про ' + file, 404);
    })();
  }
  const conflicts = await conflictedFiles(repo);
  const answers = resolution ? db().prepare("SELECT * FROM conflict_files WHERE resolution_id=? AND step=? AND answer<>'' AND answer_sent=0").all(resolution.id, step) as FileRow[] : [];
  if (!conflicts.length && !answers.length) throw new CodeError('Конфликтов нет', 409);
  if (!resolution) {
    const agent = conflictAgent(projectId);
    if (!getAgent(agent.agentId)) throw new CodeError('Агент для конфликтов не найден: выберите другого в настройках', 409);
    const id = randomUUID();
    const session = createSession({ project_id: projectId, task_id: workspaceId ? getWorkspace(workspaceId).task_id : undefined, agent_id: agent.agentId, model: agent.model, role: 'conflict-resolver', policy: 'allow-edits',
      title: 'Конфликты · ' + operation.kind + (operation.branch ? ' · ' + operation.branch : ''),
      metadata: { workspace_id: workspaceId ?? null, conflict_resolution: id, ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
        briefing: 'Ты разрешаешь конфликты merge/rebase в рабочей копии разработчика. Сначала вызови get_conflicts: там правила, стороны и список файлов. По каждому файлу сообщай только через report_conflict_file, не в чат.' } });
    db().prepare('INSERT INTO conflict_resolutions(id,project_id,operation_id,session_id) VALUES (?,?,?,?)').run(id, projectId, operation.id, session.id);
    resolution = openResolution(projectId, workspaceId)!;
  }
  // The agent may edit exactly these files; Plangent checks every edit against the list.
  const session = getSession(resolution.session_id);
  updateSession(session.id, { metadata: { ...session.metadata, conflict_paths: conflicts.map(c => c.path) } });
  const note = typeof input.note === 'string' && input.note.trim() ? '\nПожелание разработчика: ' + input.note.trim().slice(0, 4000) : '';
  const text = (answers.length ? 'Разработчик ответил по файлам (answers в get_conflicts). ' : '') +
    (conflicts.length ? 'Разреши конфликты: вызови get_conflicts, исправь файлы и сообщи по каждому через report_conflict_file.' : 'Учти ответы и сообщи по этим файлам через report_conflict_file.') + note;
  db().prepare('UPDATE conflict_files SET answer_sent=1 WHERE resolution_id=? AND step=? AND answer<>\'\'').run(resolution.id, step);
  try { await sendPrompt(session.id, [{ type: 'text', text }]); }
  catch (error) {
    db().prepare('UPDATE conflict_files SET answer_sent=0 WHERE resolution_id=? AND step=? AND answer<>\'\'').run(resolution.id, step);
    throw error;
  }
  changed(projectId);
  return conflictState(projectId, workspaceId);
}

export async function stopConflicts(projectId: string, workspaceId?: string) {
  const resolution = openResolution(projectId, workspaceId);
  if (resolution) await cancelSession(resolution.session_id);
  return { stopped: !!resolution };
}

// --- the agent's tools ------------------------------------------------------------
async function sessionContext(session: AgentSession) {
  if (session.role !== 'conflict-resolver') throw new CodeError('Conflict resolver role required', 403);
  const resolution = db().prepare('SELECT * FROM conflict_resolutions WHERE id=? AND session_id=? AND closed=0').get(session.metadata.conflict_resolution, session.id) as ResolutionRow | undefined;
  if (!resolution || resolution.project_id !== session.project_id) throw new CodeError('Операция уже завершена', 409);
  const repo = root(session.project_id, session.metadata.workspace_id as string | undefined), operation = await gitOperation(repo);
  if (!operation || operation.id !== resolution.operation_id) throw new CodeError('Операция уже завершена или сменилась', 409);
  return { repo, operation, resolution, step: stepOf(operation) };
}
function sides(o: GitOperationState) {
  const commit = o.commit ? o.commit.sha.slice(0, 12) + ' «' + o.commit.subject + '»' : 'неизвестный коммит';
  if (o.kind === 'rebase') return {
    ours: 'база, на которую переносят ветку: ' + (o.onto?.name ?? o.onto?.sha.slice(0, 12) ?? 'неизвестно') + ' — это чужие изменения',
    theirs: 'переносимый коммит ветки ' + (o.branch ?? '') + ': ' + commit + ' — это изменения разработчика',
  };
  if (o.kind === 'merge') return { ours: 'текущая ветка ' + (o.branch ?? '(detached HEAD)') + ' — изменения разработчика', theirs: 'вливаемое: ' + (o.commit?.name ?? '') + ' ' + commit };
  if (o.kind === 'cherry-pick') return { ours: 'текущая ветка ' + (o.branch ?? '(detached HEAD)'), theirs: 'переносимый cherry-pick коммит ' + commit };
  return { ours: 'текущая ветка ' + (o.branch ?? '(detached HEAD)'), theirs: 'отмена (revert) коммита ' + commit };
}
/** get_conflicts */
export async function conflictBrief(session: AgentSession) {
  const { repo, operation, resolution, step } = await sessionContext(session);
  const conflicts = await conflictedFiles(repo);
  const notes = db().prepare('SELECT * FROM conflict_files WHERE resolution_id=? AND step=?').all(resolution.id, step) as FileRow[];
  const message = operation.commit ? (await runGit(repo, ['log', '-1', '--format=%B', operation.commit.sha, '--']).catch(() => '')).trim() : '';
  return {
    protocol: PROTOCOL,
    operation: { kind: operation.kind, branch: operation.branch, step: operation.step, commit: operation.commit ? { ...operation.commit, message } : null, onto: operation.onto },
    sides: sides(operation),
    files: conflicts.map(c => ({ path: c.path, code: c.code, meaning: CODES[c.code] ?? c.code })),
    previous: notes.map(n => ({ path: n.path, outcome: n.outcome, text: n.text })),
    answers: notes.filter(n => n.answer).map(n => ({ path: n.path, question: n.text, answer: n.answer })),
  };
}
const MARKER = /^(?:<{7}|\|{7}|>{7})(?: |$)/m;
/** report_conflict_file */
export async function reportConflictFile(session: AgentSession, args: Record<string, unknown>) {
  const { repo, resolution, step } = await sessionContext(session);
  const outcome = String(args.outcome) as Outcome, text = String(args.text ?? '').trim();
  if (!OUTCOMES.includes(outcome)) throw new CodeError('outcome: resolved, question или recommend');
  if (!text) throw new CodeError('Напишите text');
  const full = codePath(repo, String(args.path ?? ''));
  const file = path.relative(repo, full).replace(/\\/g, '/');
  const known = (session.metadata.conflict_paths as string[] | undefined) ?? [];
  if (!known.includes(file)) throw new CodeError('Это не конфликтный файл: ' + file + '. Конфликтные: ' + known.join(', '));
  if (outcome === 'resolved') {
    const content = await fs.readFile(full, 'utf8').catch(() => null);
    if (content === null) throw new CodeError('Файла нет. Удаление не решение: сообщи outcome recommend и посоветуй, что сделать');
    if (MARKER.test(content)) throw new CodeError('В файле остались маркеры конфликта. Убери их или сообщи outcome question');
  }
  db().prepare(`INSERT INTO conflict_files(resolution_id,step,path,outcome,text) VALUES (?,?,?,?,?)
    ON CONFLICT(resolution_id,step,path) DO UPDATE SET outcome=excluded.outcome,text=excluded.text,answer='',answer_sent=0,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')`)
    .run(resolution.id, step, file, outcome, text.slice(0, 20000));
  changed(session.project_id);
  return { saved: true, path: file, outcome };
}
