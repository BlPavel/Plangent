import { conflictRecords } from '../../../infrastructure/db/repositories/git/conflicts';
import { rootForWorkspace } from '../../workspaces';
import { getWorkspace } from '../../workspaces';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { broadcast } from '../../shared';
import { codePath } from '../../files';
import { DomainError } from '../../../models/domain-error';
import { conflictedFiles, gitOperation, type GitOperationState } from '../../../infrastructure/git/read';
import { runGit } from '../../../infrastructure/git/write';
import { getProject } from '../../projects';
import { conflictAgent } from '../../settings';
import { getAgent } from '../../agents';
import { createAgentSession, getSession, updateSession } from '../../agents';
import { runAgentWork, cancelSession, closeSession } from '../../agents';
import type { AgentSession } from '../../agents';

/**
 * The developer runs merge/rebase themselves; when it stops on conflicts, an agent edits the conflicted files.
 * Git stays with the developer: they check the result, stage it and continue or abort the operation.
 */
const PROTOCOL = [
  'You resolve conflicts in a merge or rebase started by the developer. Do not modify git: no add, commit, rebase --continue/--abort, checkout, or merge. The developer handles these after reviewing your work.',
  'Read file versions with git show :1:<path> (common ancestor), :2:<path> (ours), and :3:<path> (theirs); git log and git diff are also available. See sides for ownership. During rebase, ours is the base receiving the branch and theirs is the developer’s replayed commit.',
  'Understand each side’s intent and combine both changes. Do not take one side wholesale when both changes matter. Remove all conflict markers <<<<<<< ||||||| ======= >>>>>>>.',
  'Edit only conflicted files. Do not run installation, build, test, or generation commands. If a command is needed, such as rebuilding a lockfile, report it.',
  'Call report_conflict_file for every file. For outcome resolved, briefly describe the conflict and resolution in text; Plangent checks for remaining markers. Do not tell the developer to review, stage, or continue. For question, leave disputed markers in place and ask in text. For recommend, explain what to do when editing cannot resolve the conflict (such as deletion, binary files, or lockfiles).',
  'Consider developer answers in answers and report those files again. Do not write a final chat summary; report everything through report_conflict_file. Write in Russian.',
];
const CODES: Record<string, string> = {
  UU: 'изменён с обеих сторон', AA: 'добавлен с обеих сторон', DD: 'удалён с обеих сторон',
  DU: 'удалён в ours, изменён в theirs', UD: 'изменён в ours, удалён в theirs', AU: 'добавлен только в ours', UA: 'добавлен только в theirs',
};
const OUTCOMES = ['resolved', 'question', 'recommend'] as const;
type Outcome = typeof OUTCOMES[number];
interface ResolutionRow { id: string; project_id: string; operation_id: string; session_id: string; closed: number }
interface FileRow { resolution_id: string; step: string; path: string; outcome: Outcome; text: string; answer: string; answer_sent: number; updated_at: string }


/** One stop of the operation: every commit of a rebase brings its own conflicts. */
const stepOf = (operation: GitOperationState) => operation.commit?.sha ?? operation.kind;
const changed = (projectId: string) => broadcast({ type: 'conflicts:changed', projectId });

function root(projectId: string, workspaceId?: string): string {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project') throw new DomainError('Project not found', 404);
  return rootForWorkspace(projectId, workspaceId);
}
function openResolution(projectId: string, workspaceId?: string): ResolutionRow | undefined {
  return conflictRecords.findOpenResolution(projectId, workspaceId ?? '') as ResolutionRow | undefined;
}
/** The operation ended (continued or aborted) or another one began: the agent of the old one is not needed any more. */
async function close(resolution: ResolutionRow) {
  conflictRecords.closeResolution(resolution.id);
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
  const notes = resolution ? conflictRecords.listOrderedNotes(resolution.id, step) as FileRow[] : [];
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
  if (!operation) throw new DomainError('Нет незавершённого merge или rebase', 409);
  const step = stepOf(operation);
  let resolution = open;
  if (resolution) {
    const status = (() => { try { return getSession(resolution.session_id).status; } catch { return 'gone'; } })();
    if (['starting', 'thinking', 'waiting'].includes(status)) throw new DomainError('Агент работает: дождитесь конца ответа', 409);
    if (status === 'gone') { await close(resolution); resolution = undefined; }
  }
  const replies = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)
    ? Object.entries(input.answers as Record<string, unknown>).filter(([, text]) => typeof text === 'string' && text.trim()) : [];
  if (replies.length) {
    if (!resolution) throw new DomainError('Агент ещё не разбирал конфликты', 409);
    conflictRecords.transaction(() => {
      for (const [file, text] of replies)
        if (!conflictRecords.saveAnswer(String(text).trim().slice(0, 20000), resolution!.id, step, file).changes) throw new DomainError('Агент не спрашивал про ' + file, 404);
    });
  }
  const conflicts = await conflictedFiles(repo);
  const answers = resolution ? conflictRecords.listUnsentAnswers(resolution.id, step) as FileRow[] : [];
  if (!conflicts.length && !answers.length) throw new DomainError('Конфликтов нет', 409);
  if (!resolution) {
    const agent = conflictAgent(projectId);
    if (!getAgent(agent.agentId)) throw new DomainError('Агент для конфликтов не найден: выберите другого в настройках', 409);
    const id = randomUUID();
    const session = createAgentSession({ project_id: projectId, task_id: workspaceId ? getWorkspace(workspaceId).task_id : undefined, agent_id: agent.agentId, model: agent.model, role: 'conflict-resolver', policy: 'allow-edits',
      title: 'Конфликты · ' + operation.kind + (operation.branch ? ' · ' + operation.branch : ''),
      metadata: { workspace_id: workspaceId ?? null, conflict_resolution: id, ...(agent.effort ? { reasoningEffort: agent.effort } : {}),
        briefing: 'You resolve merge or rebase conflicts in the developer’s worktree. First call get_conflicts for rules, sides, and files. Report each file only through report_conflict_file, not in chat. Write reports in Russian.' } });
    conflictRecords.insertResolution(id, projectId, operation.id, session.id);
    resolution = openResolution(projectId, workspaceId)!;
  }
  // The agent may edit exactly these files; Plangent checks every edit against the list.
  const session = getSession(resolution.session_id);
  updateSession(session.id, { metadata: { ...session.metadata, conflict_paths: conflicts.map(c => c.path) } });
  const note = typeof input.note === 'string' && input.note.trim() ? '\nDeveloper request: ' + input.note.trim().slice(0, 4000) : '';
  const text = (answers.length ? 'The developer answered about files (see answers in get_conflicts). ' : '') +
    (conflicts.length ? 'Resolve conflicts: call get_conflicts, edit the files, and report each with report_conflict_file.' : 'Consider the answers and report the files with report_conflict_file.') + note;
  conflictRecords.markAnswersSent(resolution.id, step);
  try { await runAgentWork(session.id, [{ type: 'text', text }]); }
  catch (error) {
    conflictRecords.markAnswersUnsent(resolution.id, step);
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
  if (session.role !== 'conflict-resolver') throw new DomainError('Conflict resolver role required', 403);
  const resolution = conflictRecords.findSessionResolution(session.metadata.conflict_resolution, session.id) as ResolutionRow | undefined;
  if (!resolution || resolution.project_id !== session.project_id) throw new DomainError('Операция уже завершена', 409);
  const repo = root(session.project_id, session.metadata.workspace_id as string | undefined), operation = await gitOperation(repo);
  if (!operation || operation.id !== resolution.operation_id) throw new DomainError('Операция уже завершена или сменилась', 409);
  return { repo, operation, resolution, step: stepOf(operation) };
}
function sides(o: GitOperationState) {
  if (o.kind === 'conflict') return { ours: 'текущие изменения рабочей копии', theirs: 'применяемые изменения' };
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
  const notes = conflictRecords.listNotes(resolution.id, step) as FileRow[];
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
  if (!OUTCOMES.includes(outcome)) throw new DomainError('outcome: resolved, question или recommend');
  if (!text) throw new DomainError('Напишите text');
  const full = codePath(repo, String(args.path ?? ''));
  const file = path.relative(repo, full).replace(/\\/g, '/');
  const known = (session.metadata.conflict_paths as string[] | undefined) ?? [];
  if (!known.includes(file)) throw new DomainError('Это не конфликтный файл: ' + file + '. Конфликтные: ' + known.join(', '));
  if (outcome === 'resolved') {
    const content = await fs.readFile(full, 'utf8').catch(() => null);
    if (content === null) throw new DomainError('Файла нет. Удаление не решение: сообщи outcome recommend и посоветуй, что сделать');
    if (MARKER.test(content)) throw new DomainError('В файле остались маркеры конфликта. Убери их или сообщи outcome question');
  }
  conflictRecords.saveReport(resolution.id, step, file, outcome, text.slice(0, 20000));
  changed(session.project_id);
  return { saved: true, path: file, outcome };
}
