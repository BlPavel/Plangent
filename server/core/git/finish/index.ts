import { finishSessionsRecords } from '../../../infrastructure/db/repositories/git/finish-sessions';
import { rootForWorkspace, rootForTask } from '../../workspaces';
import { activeWorkspace } from '../../workspaces';
import { randomUUID } from 'node:crypto';
import { getProject } from '../../projects';
import { effectiveGitSettings, gitAgent } from '../../settings';
import { resolveCommitRules } from '../../library';
import { getTask } from '../../tasks';
import { taskMrs } from '../merge-requests';
import { resolveCodeHost } from '../hosts';
import { DomainError } from '../../../models/domain-error';
import { assertRepositoryIdle } from '../repo/git-busy';
import { serializeGit, resetForReassembly, stage, commit, push, createBranch, fetchRepository, GitOperationError, assertNoGitOperation } from '../repo/git-write';
import { repositoryInfo, treeChanges, snapshot, diffFile, originUrl, publishedWorkflowCommits, changedFiles } from '../../../infrastructure/git/read';
import { assembleCommitMessage, cleanCommitMessage, inspectCommitMessage, validateCommitMessage } from '../commits/commit-message';
import { createAgentSession, getSession, updateSession } from '../../agents';
import { runAgentWork, onAgentEvent, closeSession } from '../../agents';
import type { AgentSession } from '../../agents';
import type { FinishCommit, FinishMrDraft, FinishOptions, FinishRun } from '../../../models/finish';
import { getFinish, activeFinish, insertFinish, updateFinish, taskFinishState, cancelOrphanFinishes } from './store';
import { transition } from './state';
import { broadcast } from '../../shared';
import { moduleDependencies } from '../dependencies';
import fs from 'node:fs/promises';
export { getFinish, activeFinish, taskFinishState };
/** The agent gets this many chances to fix a commit that git (or a hook) rejected, then the developer decides. */
export const MAX_HOOK_ATTEMPTS = 3;
/** An error the workflow has already stored in the run (and told the agent about): `locked` leaves the run as it is. */
class Reported extends DomainError {}
/** A git hook rewrote working files after a commit (a formatter, for example): the commits no longer match what was reviewed. */
class HookChangedFiles extends Error { constructor(public files: string[]) { super('Хук изменил рабочие файлы'); } }
/** What the user sees for a failed step: for git, the reason is in its output (a hook, an identity, a lock), not in the generic message. */
function failure(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const output = error instanceof GitOperationError ? error.output.trim().split('\n').slice(-15).join('\n') : '';
  return output ? error.message + '\n' + output : error.message;
}
const final = (run: FinishRun) => ['complete', 'cancelled'].includes(run.status);
export function validateCommitFiles(commits: unknown, paths: string[]): asserts commits is FinishCommit[] {
  if (!Array.isArray(commits) || !commits.length || commits.length > 1000) throw new DomainError('Предложите список коммитов');
  const expected = new Set(paths), seen = new Set<string>();
  for (const item of commits) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.files) || !item.files.length || typeof item.title !== 'string' || !item.title.trim() || /[\r\n\0]/.test(item.title) || item.body !== undefined && typeof item.body !== 'string')
      throw new DomainError('Каждый коммит должен содержать файлы и заголовок одной строкой');
    for (const file of item.files) {
      if (typeof file !== 'string' || !expected.has(file)) throw new DomainError('Неизвестный файл: ' + String(file));
      if (seen.has(file)) throw new DomainError('Файл включён в несколько коммитов: ' + file);
      seen.add(file);
    }
  }
  const missing = paths.filter(file => !seen.has(file));
  if (missing.length) throw new DomainError('Файлы не включены в коммиты: ' + missing.join(', '));
}
export function createFinishService(dependencies: {
  prompt?: (id: string, content: Parameters<typeof runAgentWork>[1]) => Promise<void>; close?: typeof closeSession; mrs?: Pick<ReturnType<typeof taskMrs>, 'preview' | 'create'>; resolve?: typeof resolveCodeHost;
} = {}) {
  const controllers = new Map<string, AbortController>();
  /** Rejected commits of the current agent series; a new series (start, revision) begins at zero. */
  const attempts = new Map<string, number>();
  const prompt = dependencies.prompt ?? runAgentWork;
  const close = dependencies.close ?? closeSession;
  const mrs = () => dependencies.mrs ?? taskMrs();
  const resolveHost = dependencies.resolve ?? resolveCodeHost;
  const rootFor = (run: FinishRun) => {
    const project = getProject(run.project_id);
    if (!project || project.kind !== 'project') throw new DomainError('Project not found', 404);
    return run.workspace_id ? rootForWorkspace(run.project_id, run.workspace_id) : project.repo_path;
  };
  function notify(run: FinishRun, title: string, message?: string) {
    broadcast({ type: 'finish:notification', projectId: run.project_id, taskId: run.task_id, runId: run.id, title, message: message || run.error || title });
  }
  function output(runId: string) {
    return (chunk: string) => {
      const run = getFinish(runId);
      updateFinish(runId, { output: (run.output + chunk).slice(-1000000) });
      broadcast({ type: 'git:progress', project_id: run.project_id, operationId: runId, output: chunk });
    };
  }
  const optionsFor = (run: FinishRun) => ({ signal: controllers.get(run.id)?.signal, assertIdle: () => assertRepositoryIdle(run.project_id, run.id, rootFor(run)), onOutput: output(run.id) });
  async function locked<T>(id: string, action: (run: FinishRun, root: string) => Promise<T>): Promise<T> {
    const initial = getFinish(id), root = rootFor(initial);
    return serializeGit(root, async () => {
      const run = getFinish(id);
      if (final(run)) throw new DomainError('Завершение уже закрыто', 409);
      assertRepositoryIdle(run.project_id, run.id, rootFor(run));
      const controller = new AbortController(); controllers.set(id, controller);
      try { return await action(run, root); }
      catch (error) {
        if (error instanceof Reported) throw error;
        const latest = getFinish(id);
        // A refused request (stale state, validation) is only reported to its caller: the stored cause of the failure stays visible.
        // Only a running workflow fails with it, and a git failure always replaces the text, since it is the newest cause.
        if (latest.status === 'running' || error instanceof GitOperationError) {
          updateFinish(id, { ...(latest.status === 'running' ? { status: 'error' as const } : {}), error: failure(error) });
          notify(getFinish(id), 'Ошибка завершения работ');
        }
        throw error;
      } finally { controllers.delete(id); }
    });
  }
  /** The branch and HEAD are still the ones this finish created, and nothing is published: the commits are ours to take back. */
  async function ownedHead(run: FinishRun, root: string, checkPublished = false) {
    const info = await repositoryInfo(root);
    const expected = [...run.commits].reverse().find(c => c.sha)?.sha ?? run.base_head;
    if (info?.head !== expected || info.branch !== run.branch) throw new DomainError('HEAD или ветка изменились. Пересборка недоступна', 409);
    if (run.pushed) throw new DomainError('Коммиты уже опубликованы. Пересборка недоступна', 409);
    if (checkPublished && expected !== run.base_head && await originUrl(root)) {
      await fetchRepository(root, optionsFor(run));
      if (await publishedWorkflowCommits(root, run.base_head, expected)) throw new DomainError('Коммиты уже опубликованы. Пересборка недоступна', 409);
    }
    return expected;
  }
  /** Reassembling the commits also needs the files to be exactly what was reviewed; taking the commits back does not (the files stay as they are). */
  async function unchanged(run: FinishRun, root: string, checkPublished = false) {
    const expected = await ownedHead(run, root);
    if (await snapshot(root) !== run.snapshot_tree) throw new DomainError('Рабочие файлы изменились вне завершения. Откройте внешний клиент', 409);
    if (checkPublished) await ownedHead(run, root, true);
    return expected;
  }
  /**
   * A task's finish that went through closes its work, as «Закрыть работу» does: the folder goes, the branch keeps the commits.
   * It runs after the repository lock is released; a work that cannot be closed stays open and says why.
   */
  function closeFinishedWork(run: FinishRun) {
    const work = moduleDependencies.work;
    if (run.status !== 'complete' || !run.task_id || !work || getTask(run.task_id)?.closed_at) return;
    void work.closeWork(run.task_id).catch(error => notify(run, 'Ошибка закрытия работы','Завершение выполнено, но закрыть работу не удалось: ' + failure(error)));
  }
  async function closeCommitter(run: FinishRun) {
    if (!run.session_id) return;
    await close(run.session_id).catch(() => {});
    try { updateSession(run.session_id, { status: 'complete' }); } catch { /* the session is gone with its task */ }
  }
  async function beginAgent(run: FinishRun) {
    attempts.delete(run.id);
    const agent = gitAgent(run.project_id);
    const single = run.options.commitMode === 'single', full = run.scenario === 'full';
    const session = run.session_id ? getSession(run.session_id) : createAgentSession({
      project_id: run.project_id, task_id: run.task_id, agent_id: agent.agentId, model: agent.model,
      role: 'committer', policy: 'read-only', title: 'Завершение работ',
      metadata: { finish_id: run.id, workspace_id: run.workspace_id ?? null, ...(agent.effort ? { reasoningEffort: agent.effort } : {}), briefing: 'You propose a set of commits. First call get_finish_context, then set_commits with the complete list; follow commit_rules in the context for titles and descriptions. '
        + (full ? 'Then call set_merge_request with a one-line title and an MR description following mr.template in the context; Plangent supplies the target branch, reviewers, and assignees. ' : '') + 'Then call finish_commits. '
        + (single ? 'Put all changes in exactly one commit. ' : 'Choose the number of commits: group logically separate changes without splitting minor details. ')
        + 'Correct the list if there is an error. If git or a repository hook rejects a commit, the error shows the hook output: fix the title or description when that is the reason, and stop and tell the developer when it is not. Do not modify files or git through the shell. Plangent makes commits and handles push and the MR according to the selected mode. Do not add agent attribution. Write other text for the developer in their language, Russian by default.' },
    });
    if (session.role !== 'committer' || session.policy !== 'read-only') throw new DomainError('Invalid committer session');
    updateFinish(run.id, { session_id: session.id });
    await prompt(session.id, [{ type: 'text', text: run.note ? 'Revise the ' + (full ? 'commits and MR' : 'commits') + ': ' + run.note
      : (single ? 'Put all changes in one commit' : 'Split the changes into meaningful commits') + (full ? ' and write the MR' : '')
        + (run.options.autoContinue ? ', then call finish_commits: Plangent will automatically complete the selected workflow.' : ' and submit them for confirmation.') }]);
  }
  /** The text the user confirms with the commits: only the full cycle has one. */
  function validateMr(title: unknown, description: unknown): FinishMrDraft {
    if (typeof title !== 'string' || !title.trim() || title.length > 1000 || /[\r\n\0]/.test(title)) throw new DomainError('Заголовок МР — одна непустая строка');
    if (typeof description !== 'string' || description.length > 100000) throw new DomainError('Некорректное описание МР');
    return { title: title.trim(), description };
  }
  /** The agent (while it proposes the commits) or the user (while they confirm) sets the MR text; nothing is created yet. */
  async function setMergeRequest(id: string, title: unknown, description: unknown) {
    const draft = validateMr(title, description);
    const run = getFinish(id);
    if (final(run) || run.scenario !== 'full' || !['commits', 'confirmation'].includes(run.stage)) throw new DomainError('МР можно менять до подтверждения, только в полном цикле', 409);
    return updateFinish(id, { mr_draft: draft });
  }
  /** After the push: creates the MR from the confirmed text; a failure leaves the run at this stage so «Повторить» retries it. */
  async function publishMr(run: FinishRun) {
    if (!run.mr_draft) throw new DomainError('Нет текста МР. Откатите коммиты и начните заново', 409);
    try {
      const preview = await mrs().preview(run.project_id, run.task_id ?? undefined, run.options.targetBranch);
      const mr = await mrs().create(run.project_id, { ...preview, title: run.mr_draft.title, description: run.mr_draft.description }, true, run.id);
      const done = updateFinish(run.id, { ...transition(getFinish(run.id), 'mr_done'), mr_url: mr.web_url, error: '' });
      if (run.session_id) { await close(run.session_id).catch(() => {}); updateSession(run.session_id, { status: 'complete' }); }
      notify(done, 'МР создан', mr.web_url);
      return done;
    } catch (error) {
      const failed = updateFinish(run.id, { status: 'error', error: failure(error) });
      notify(failed, 'Ошибка создания МР'); throw error;
    }
  }
  async function start(projectId: string, input: FinishOptions) {
    const project = getProject(projectId);
    if (!project || project.kind !== 'project') throw new DomainError('Project not found', 404);
    if (!input || !['nothing','commits','push','full'].includes(input.scenario)) throw new DomainError('Invalid finish scenario');
    if (input.scenario === 'nothing') return null;
    if (input.task_id && getTask(input.task_id)?.project_id !== projectId) throw new DomainError('Task not found', 404);
    const defaults = effectiveGitSettings(projectId).values;
    gitAgent(projectId);
    if (input.commitMode !== undefined && !['single', 'split'].includes(input.commitMode)) throw new DomainError('Invalid commit mode');
    if (input.scenario === 'full' && (typeof input.targetBranch !== 'string' || !input.targetBranch.trim())) throw new DomainError('Выберите целевую ветку');
    if (input.autoContinue !== undefined && typeof input.autoContinue !== 'boolean') throw new DomainError('Invalid autoContinue');
    const scenario = input.scenario;
    if (scenario === 'full') await resolveHost(projectId).catch(error => { throw new DomainError('«Полный цикл» недоступен без подключения к хостингу: ' + (error instanceof Error ? error.message : failure(error))); });
    for (const key of ['targetBranch', 'branchName', 'baseBranch', 'task_id'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'string') throw new DomainError('Invalid ' + key);
    }
    const params: FinishOptions = {
      scenario, task_id: input.task_id, branchName: input.branchName, baseBranch: input.baseBranch || undefined,
      includeDescription: input.includeDescription ?? defaults.include_description,
      includeCoauthors: input.includeCoauthors ?? false, coauthors: input.coauthors,
      targetBranch: input.targetBranch || defaults.base_branch, commitMode: input.commitMode ?? 'split', autoContinue: input.autoContinue ?? false,
    };
    // Validate explicit flags and human coauthors before touching Git.
    assembleCommitMessage({ title: 'validate', ...params });
    const workspace = input.task_id ? activeWorkspace(input.task_id) : null;
    const root = input.task_id ? rootForTask(input.task_id) : project.repo_path;
    if (workspace) { rootForWorkspace(projectId, workspace.id); params.branchName = undefined; }
    return serializeGit(root, async () => {
      cancelOrphanFinishes();
      assertRepositoryIdle(projectId, undefined, root);
      await assertNoGitOperation(root);
      if (activeFinish(projectId, workspace?.id)) throw new DomainError('В проекте уже идёт завершение', 409);
      const info = await repositoryInfo(root);
      if (!info?.head || !info.branch) throw new DomainError('Нужна локальная ветка с исходным коммитом');
      if ((await changedFiles(root)).some(c => c.status === 'U')) throw new DomainError('Разрешите конфликты во внешнем клиенте');
      const tree = await snapshot(root);
      if (!tree || !(await treeChanges(root, info.head, tree)).changes.length) throw new DomainError('Нет изменений для завершения');
      const target = params.targetBranch?.replace(/^origin\//, '');
      if (!workspace && info.branch === target && !params.branchName) throw new DomainError('Создайте рабочую ветку: укажите branchName');
      const now = new Date().toISOString();
      let run = insertFinish({ id: randomUUID(), project_id: projectId, task_id: input.task_id ?? null, workspace_id: workspace?.id ?? null, scenario, options: params,
        base_head: info.head, branch: info.branch, snapshot_tree: tree, stage: 'branch', status: 'running', commits: [],
        session_id: null, note: '', error: '', output: '', pushed: false, mr_url: null, mr_draft: null, hook_changes: [], created_at: now, updated_at: now });
      try {
        if (params.branchName) {
          await createBranch(root, params.branchName, params.baseBranch || info.branch, optionsFor(run));
          // The new branch may start elsewhere than the current one: the commits are counted from its own head.
          const created = await repositoryInfo(root);
          run = updateFinish(run.id, { branch: params.branchName, ...(created?.head ? { base_head: created.head } : {}) });
        }
        run = updateFinish(run.id, transition(run, 'branch_ready'));
        await beginAgent(run); return getFinish(run.id);
      } catch (error) { run = updateFinish(run.id, { status: 'error', error: failure(error) }); notify(run, 'Ошибка завершения работ'); throw error; }
    });
  }
  /** The MR body the project's defaults start from (task title, key, link): the agent writes the real description over it. */
  async function mrTemplate(run: FinishRun) {
    try { const preview = await mrs().preview(run.project_id, run.task_id ?? undefined, run.options.targetBranch); return { title: preview.title, description: preview.description }; } catch { return null; }
  }
  async function context(id: string) {
    const run = getFinish(id), root = rootFor(run);
    const task = run.task_id ? getTask(run.task_id) : null;
    const changes = (await treeChanges(root, run.base_head, run.snapshot_tree)).changes;
    let remaining = 200000;
    const diffs: Record<string,string> = {};
    for (const change of changes) {
      if (remaining <= 0) break;
      const diff = await diffFile(root, change.path, { base: run.base_head, end: run.snapshot_tree, originalPath: change.originalPath });
      diffs[change.path] = diff.slice(0, remaining); remaining -= diffs[change.path].length;
    }
    return { changes, diffs, diffLimit: 200000, settings: effectiveGitSettings(run.project_id).values, commit_rules: resolveCommitRules(run.project_id), options: run.options,
      task: task ? { key: task.key, title: task.title, description: task.description } : null, commits: run.commits, note: run.note,
      mr: run.scenario === 'full' ? { draft: run.mr_draft, template: await mrTemplate(run) } : null };
  }
  /** What the agent is told when git rejected its commit: the output of the hook, and what to do about it. */
  function rejection(error: GitOperationError, attempt: number, exhausted: boolean) {
    const output = error.output.trim().split('\n').slice(-30).join('\n');
    return `Git rejected the commit (attempt ${attempt} of ${MAX_HOOK_ATTEMPTS}):\n${output || error.message}\n\n`
      + (exhausted ? 'Attempts are used up. Do not call set_commits again: stop and tell the developer; they will fix the commits in Plangent.'
        : 'If the reason is the commit title or description, fix the text and call set_commits again. If it is something else (a missing file, a failing check, the environment), do not retry: stop and tell the developer.');
  }
  /** The proposal is kept for the developer: the commits made so far, then the rest without a SHA, at the confirmation step with the error. */
  function park(id: string, list: FinishCommit[], error: string, hookFiles: string[] = []) {
    const done = getFinish(id).commits;
    const parked = updateFinish(id, { stage: 'confirmation', status: 'error', commits: [...done, ...list.slice(done.length).map(item => ({ ...item }))], error, hook_changes: hookFiles });
    notify(parked, 'Ошибка завершения работ');
    return parked;
  }
  async function setCommits(id: string, proposed: unknown, generated = false, overrideForbidden = false, skipHooks = false) {
    return locked(id, async (run, root) => {
      if (!['commits','confirmation'].includes(run.stage)) throw new DomainError('Коммиты недоступны на этом этапе');
      if (!generated && run.stage !== 'confirmation') throw new DomainError('Дождитесь подтверждения');
      const changes = (await treeChanges(root, run.base_head, run.snapshot_tree)).changes;
      validateCommitFiles(proposed, changes.map(c => c.path));
      if (generated && run.options.commitMode === 'single' && proposed.length !== 1) throw new DomainError('Нужен ровно один коммит со всеми файлами');
      const settings = effectiveGitSettings(run.project_id).values;
      const list: FinishCommit[] = proposed.map(item => {
        const raw = [item.title, run.options.includeDescription ? item.body : ''].filter(Boolean).join('\n\n');
        const text = generated ? cleanCommitMessage(raw, settings).trim() : raw;
        const [title, ...body] = text.split('\n');
        const data = { files: [...item.files], title, body: run.options.includeDescription ? body.join('\n').trim() : '' };
        const message = assembleCommitMessage({ ...data, ...run.options });
        if ((generated ? validateCommitMessage(message, settings) : inspectCommitMessage({ ...data, ...run.options }, settings).violations).some(v => v.kind === 'forbidden') && (generated || !overrideForbidden))
          throw new DomainError('Запрещённая атрибуция в сообщении коммита');
        return data;
      });
      const expected = await unchanged(run, root, true);
      updateFinish(id, { status: 'running', error: '', output: '', hook_changes: [] });
      try {
        await resetForReassembly(root, run.base_head, expected, optionsFor(run));
        // Persist every SHA so a hook failure remains recoverable.
        run = updateFinish(id, { commits: [] });
        for (const data of list) {
          const paths = data.files.flatMap(file => { const change = changes.find(c => c.path === file)!; return change.originalPath ? [change.originalPath, file] : [file]; });
          await stage(root, paths, optionsFor(run));
          // Only the developer may skip the hooks; an agent's call never does.
          await commit(root, { ...data, ...run.options }, () => effectiveGitSettings(run.project_id).values, optionsFor(run), overrideForbidden && !generated, undefined, skipHooks && !generated);
          const sha = (await repositoryInfo(root))!.head!;
          run = updateFinish(id, { commits: [...run.commits, { ...data, sha }] });
          const current = await snapshot(root);
          if (current !== run.snapshot_tree) throw new HookChangedFiles((await treeChanges(root, run.snapshot_tree, current!)).changes.map(c => c.path).slice(0, 100));
        }
        attempts.delete(id);
        return updateFinish(id, { status: run.stage === 'confirmation' ? 'waiting' : 'running', error: '' });
      } catch (error) {
        if (error instanceof HookChangedFiles) {
          const shown = error.files.slice(0, 10).join('\n');
          const text = 'Хук изменил файлы после коммита, коммиты не соответствуют проверенному:\n' + shown + (error.files.length > 10 ? '\n…' : '')
            + '\nВключите изменения хука в коммиты, откатите коммиты или отмените завершение.';
          park(id, list, text, error.files);
          // The agent cannot fix this: it stops, the developer chooses.
          throw new Reported(generated ? 'A git hook changed working files after the commit (' + error.files.slice(0, 5).join(', ') + '). Do not call set_commits again: stop and tell the developer; they decide in Plangent.' : text, 409);
        }
        if (generated && error instanceof GitOperationError && error.code === 'git_failed') {
          const attempt = (attempts.get(id) ?? 0) + 1, exhausted = attempt >= MAX_HOOK_ATTEMPTS;
          attempts.set(id, attempt);
          const reason = failure(error);
          if (exhausted) park(id, list, `Git отклонил коммит ${attempt} раз подряд. Исправьте заголовки или вывод хука ниже, затем нажмите «Сохранить».\n` + reason);
          else updateFinish(id, { status: 'running', error: `Git отклонил коммит (попытка ${attempt} из ${MAX_HOOK_ATTEMPTS}), агент исправляет:\n` + reason });
          throw new Reported(rejection(error, attempt, exhausted), 409);
        }
        updateFinish(id, { status: 'error', error: failure(error) }); throw error;
      }
    });
  }
  async function finishCommits(id: string) {
    const run = await commitsFinished(id);
    closeFinishedWork(run);
    return run;
  }
  async function commitsFinished(id: string) {
    return locked(id, async (run, root) => {
      if (!run.commits.length || run.commits.some(c => !c.sha)) throw new DomainError('Сначала создайте все коммиты');
      if (run.scenario === 'full' && !run.mr_draft) throw new DomainError('Сначала вызовите set_merge_request: напишите заголовок и описание МР');
      await unchanged(run, root);
      const changes = (await treeChanges(root, run.base_head, run.snapshot_tree)).changes;
      validateCommitFiles(run.commits, changes.map(c => c.path));
      const ready = { ...run, ...transition(run, 'commits_ready') };
      if (run.options.autoContinue) {
        const accepted = updateFinish(id, { ...transition(ready, 'accept'), error: '' });
        return completeAccepted(accepted, root);
      }
      const next = updateFinish(id, { stage: ready.stage, status: ready.status, error: '' });
      notify(next, 'Коммиты ждут подтверждения'); return next;
    });
  }
  async function revise(id: string, note: string) {
    if (typeof note !== 'string' || note.length > 100000) throw new DomainError('Введите замечание агенту');
    return locked(id, async (run, root) => {
      if (run.status !== 'waiting' && !(run.status === 'error' && ['commits','confirmation'].includes(run.stage))) throw new DomainError('Дождитесь завершения работы агента');
      // After a failure the agent can simply try again: a note is only required to ask for changes.
      if (!note.trim() && run.status !== 'error') throw new DomainError('Введите замечание агенту');
      if (run.session_id && ['starting','thinking'].includes(getSession(run.session_id).status)) throw new DomainError('Агент заканчивает текущий ответ');
      await unchanged(run, root, true);
      if (run.session_id && getSession(run.session_id).status === 'error') await close(run.session_id);
      run = updateFinish(id, { ...(run.stage === 'commits' ? { status: 'running' as const } : transition(run, 'revise')), note: note.trim(), error: '', hook_changes: [] });
      await beginAgent(run); return getFinish(id);
    });
  }
  async function accept(id: string) {
    const run = await accepted(id);
    closeFinishedWork(run);
    return run;
  }
  async function accepted(id: string) {
    return locked(id, async (run, root) => {
      if (run.stage === 'confirmation' && run.commits.some(c => !c.sha)) throw new DomainError('Сначала сохраните коммиты: часть из них ещё не создана', 409);
      if (run.status === 'error' && run.stage === 'mr') {
        run = updateFinish(id, { status: 'running', error: '' });
        return publishMr(run);
      }
      if (run.status === 'error' && run.stage === 'push') {
        // A lost network response may already have published the commits; retrying a normal push is safe.
        await unchanged(run, root);
        run = updateFinish(id, { status: 'running', error: '' });
      } else {
        await unchanged(run, root);
        run = updateFinish(id, { ...transition(run, 'accept'), error: '' });
      }
      return completeAccepted(run, root);
    });
  }
  /** Shared continuation for manual acceptance and automatic runs, under the repository lock. */
  async function completeAccepted(run: FinishRun, root: string) {
      const id = run.id;
      if (run.stage === 'push') {
        const info = await repositoryInfo(root), target = run.options.targetBranch?.replace(/^origin\//, '');
        if (!info?.branch || (!run.workspace_id && info.branch === target)) throw new DomainError('Push в целевую ветку запрещён');
        await push(root, optionsFor(run));
        run = updateFinish(id, { ...transition(run, 'push_done'), pushed: true });
        if (run.stage === 'mr') return publishMr(run);
      }
      if (run.session_id) { await close(run.session_id).catch(() => {}); updateSession(run.session_id, { status: 'complete' }); }
      notify(run, 'Завершение выполнено'); return run;
  }
  async function rollback(id: string) {
    const initial = getFinish(id);
    // Stop the committer first so no queued set_commits can race the reset.
    await closeCommitter(initial);
    return locked(id, async (run, root) => {
      // Taking the commits back moves only HEAD and the index, never the files: it does not matter whether the files changed since.
      const expected = await ownedHead(run, root, true);
      if (run.stage === 'push' && run.status === 'running') throw new DomainError('Дождитесь завершения push');
      await resetForReassembly(root, run.base_head, expected, optionsFor(run));
      return updateFinish(id, { ...transition(run, 'cancel'), error: '', hook_changes: [] });
    });
  }
  /**
   * Gives the finish up. Without `reset` Git is not touched at all, so it works whatever state the folder is in (a stuck hook, a deleted
   * folder); with `reset` the commits this finish created are taken back first (the files stay).
   */
  async function cancel(id: string, reset = false) {
    const initial = getFinish(id);
    if (final(initial)) throw new DomainError('Завершение уже закрыто', 409);
    if (['push', 'mr'].includes(initial.stage) && initial.status === 'running') throw new DomainError('Дождитесь завершения push или создания МР', 409);
    if (reset && initial.commits.some(c => c.sha)) return rollback(id);
    controllers.get(id)?.abort();
    await closeCommitter(initial);
    const finish = () => {
      const run = getFinish(id);
      if (final(run)) return run;
      const cancelled = updateFinish(id, { stage: run.stage, status: 'cancelled', error: '', hook_changes: [] });
      notify(cancelled, 'Завершение отменено');
      return cancelled;
    };
    // Wait for an operation that is still being aborted, unless its folder is gone.
    let root: string | null = null;
    try { root = rootFor(initial); if (!await fs.access(root).then(() => true, () => false)) root = null; } catch { root = null; }
    return root ? serializeGit(root, async () => finish()) : finish();
  }
  /** After a hook rewrote files: they join the commits (the SHAs are dropped), and the developer saves to recreate them with the hook's result. */
  async function adoptHookChanges(id: string) {
    return locked(id, async (run, root) => {
      if (!run.hook_changes.length) throw new DomainError('Хук не менял файлы', 409);
      const expected = await ownedHead(run, root, true);
      await resetForReassembly(root, run.base_head, expected, optionsFor(run));
      const tree = await snapshot(root);
      if (!tree) throw new DomainError('Не удалось прочитать рабочие файлы', 409);
      const changes = (await treeChanges(root, run.base_head, tree)).changes;
      const covered = new Set(run.commits.flatMap(c => c.files));
      const extra = changes.map(c => c.path).filter(file => !covered.has(file));
      const kept = run.commits.map(({ files, title, body }) => ({ files, title, body }));
      if (extra.length) kept[kept.length - 1].files.push(...extra);
      // Files the hook deleted are no longer in the tree.
      const present = new Set(changes.map(c => c.path));
      const commits = kept.map(c => ({ ...c, files: c.files.filter(file => present.has(file)) })).filter(c => c.files.length);
      return updateFinish(id, { stage: 'confirmation', status: 'waiting', commits, snapshot_tree: tree, hook_changes: [], error: '' });
    });
  }
  function agentRun(session: AgentSession, stages: FinishRun['stage'][] = ['commits']) {
    const id = session.metadata.finish_id;
    if (session.role !== 'committer' || session.policy !== 'read-only' || typeof id !== 'string') throw new DomainError('Invalid committer');
    const run = getFinish(id);
    if (run.session_id !== session.id || run.project_id !== session.project_id || final(run) || !stages.includes(run.stage)) throw new DomainError('Сессия не управляет этим завершением');
    return id;
  }
  /** The committer's turn ended while the commits are still being prepared: it gave up without a result, nobody else will move the run. */
  function agentStopped(sessionId: string) {
    const row = finishSessionsRecords.findActiveSessionFinish(sessionId) as { id: string } | undefined;
    if (!row) return;
    const run = getFinish(row.id);
    if (run.stage !== 'commits' || run.status !== 'running' || run.session_id !== sessionId) return;
    const stopped = updateFinish(run.id, { status: 'error', error: 'Агент закончил работу, не создав коммиты.' + (run.error ? '\n' + run.error : '') });
    notify(stopped, 'Ошибка завершения работ');
  }
  return { start, context, setCommits, finishCommits, setMergeRequest, revise, accept, rollback, cancel, adoptHookChanges, agentRun, agentStopped,
    cancelOperation(id: string) { controllers.get(id)?.abort(); },
  };
}
let service: ReturnType<typeof createFinishService> | undefined;
export const finishes = () => service ??= createFinishService();
onAgentEvent('turn_end', (sessionId: string) => finishes().agentStopped(sessionId));
// Adapter failures remain visible after the HTTP request that started the run.
onAgentEvent('error-state', (sessionId: string, reason: string) => {
  const row = finishSessionsRecords.findActiveSessionFinish(sessionId) as { id: string } | undefined;
  if (row) {
    const run = updateFinish(row.id, { status: 'error', error: reason });
    broadcast({ type: 'finish:notification', projectId: run.project_id, runId: run.id, title: 'Ошибка завершения работ', message: reason });
  }
});
