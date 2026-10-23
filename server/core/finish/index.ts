import { randomUUID } from 'node:crypto';
import { getDb } from '../../infrastructure/db/schema';
import { getProject, effectiveGitSettings, gitAgent } from '../projects';
import { resolveCommitRules } from '../library/commit-rules';
import { getTask } from '../tasks';
import { taskMrs } from '../task-mr';
import { resolveCodeHost } from '../code-hosts';
import { CodeError } from '../code/files';
import { assertRepositoryIdle } from '../code/git-busy';
import { serializeGit, resetForReassembly, stage, commit, push, createBranch, fetchRepository, GitOperationError, assertNoGitOperation } from '../code/git-write';
import { repositoryInfo, treeChanges, snapshot, diffFile, originUrl, publishedWorkflowCommits, changedFiles } from '../code/git';
import { assembleCommitMessage, cleanCommitMessage, inspectCommitMessage, validateCommitMessage } from '../code/commit-message';
import { createSession, getSession, updateSession } from '../agent-sessions/sessions';
import { sendPrompt, sessionSignals, closeSession } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';
import type { FinishCommit, FinishMrDraft, FinishOptions, FinishRun } from '../../models/finish';
import { getFinish, activeFinish, insertFinish, updateFinish, taskFinishState } from './store';
import { transition } from './state';
import { broadcast } from '../shared/events';
export { getFinish, activeFinish, taskFinishState };
/** What the user sees for a failed step: for git, the reason is in its output (a hook, an identity, a lock), not in the generic message. */
function failure(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const output = error instanceof GitOperationError ? error.output.trim().split('\n').slice(-15).join('\n') : '';
  return output ? error.message + '\n' + output : error.message;
}
const final = (run: FinishRun) => ['complete', 'cancelled'].includes(run.status);
export function validateCommitFiles(commits: unknown, paths: string[]): asserts commits is FinishCommit[] {
  if (!Array.isArray(commits) || !commits.length || commits.length > 1000) throw new CodeError('Предложите список коммитов');
  const expected = new Set(paths), seen = new Set<string>();
  for (const item of commits) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.files) || !item.files.length || typeof item.title !== 'string' || !item.title.trim() || /[\r\n\0]/.test(item.title) || item.body !== undefined && typeof item.body !== 'string')
      throw new CodeError('Каждый коммит должен содержать файлы и заголовок одной строкой');
    for (const file of item.files) {
      if (typeof file !== 'string' || !expected.has(file)) throw new CodeError('Неизвестный файл: ' + String(file));
      if (seen.has(file)) throw new CodeError('Файл включён в несколько коммитов: ' + file);
      seen.add(file);
    }
  }
  const missing = paths.filter(file => !seen.has(file));
  if (missing.length) throw new CodeError('Файлы не включены в коммиты: ' + missing.join(', '));
}
export function createFinishService(dependencies: {
  prompt?: typeof sendPrompt; close?: typeof closeSession; mrs?: Pick<ReturnType<typeof taskMrs>, 'preview' | 'create'>; resolve?: typeof resolveCodeHost;
} = {}) {
  const controllers = new Map<string, AbortController>();
  const prompt = dependencies.prompt ?? sendPrompt;
  const close = dependencies.close ?? closeSession;
  const mrs = () => dependencies.mrs ?? taskMrs();
  const resolveHost = dependencies.resolve ?? resolveCodeHost;
  const rootFor = (run: FinishRun) => {
    const project = getProject(run.project_id);
    if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
    return project.repo_path;
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
  const optionsFor = (run: FinishRun) => ({ signal: controllers.get(run.id)?.signal, assertIdle: () => assertRepositoryIdle(run.project_id, run.id), onOutput: output(run.id) });
  async function locked<T>(id: string, action: (run: FinishRun, root: string) => Promise<T>): Promise<T> {
    const initial = getFinish(id), root = rootFor(initial);
    return serializeGit(root, async () => {
      const run = getFinish(id);
      if (final(run)) throw new CodeError('Завершение уже закрыто', 409);
      assertRepositoryIdle(run.project_id, run.id);
      const controller = new AbortController(); controllers.set(id, controller);
      try { return await action(run, root); }
      catch (error) {
        const latest = getFinish(id);
        // Validation errors before a git mutation do not invalidate the user's confirmation.
        updateFinish(id, { ...(latest.status === 'running' ? { status: 'error' as const } : {}), error: failure(error) });
        notify(getFinish(id), 'Ошибка завершения работ'); throw error;
      } finally { controllers.delete(id); }
    });
  }
  async function unchanged(run: FinishRun, root: string, checkPublished = false) {
    const info = await repositoryInfo(root);
    const expected = [...run.commits].reverse().find(c => c.sha)?.sha ?? run.base_head;
    if (info?.head !== expected || info.branch !== run.branch) throw new CodeError('HEAD или ветка изменились. Пересборка недоступна', 409);
    if (run.pushed) throw new CodeError('Коммиты уже опубликованы. Пересборка недоступна', 409);
    if (await snapshot(root) !== run.snapshot_tree) throw new CodeError('Рабочие файлы изменились вне завершения. Откройте внешний клиент', 409);
    if (checkPublished && expected !== run.base_head && await originUrl(root)) {
      await fetchRepository(root, optionsFor(run));
      if (await publishedWorkflowCommits(root, run.base_head, expected)) throw new CodeError('Коммиты уже опубликованы. Пересборка недоступна', 409);
    }
    return expected;
  }
  async function beginAgent(run: FinishRun) {
    const agent = gitAgent(run.project_id);
    const single = run.options.commitMode === 'single', full = run.scenario === 'full';
    const session = run.session_id ? getSession(run.session_id) : createSession({
      project_id: run.project_id, task_id: run.task_id, agent_id: agent.agentId, model: agent.model,
      role: 'committer', policy: 'read-only', title: 'Завершение работ',
      metadata: { finish_id: run.id, ...(agent.effort ? { reasoningEffort: agent.effort } : {}), briefing: 'Ты предлагаешь состав коммитов. В начале вызови get_finish_context, затем set_commits с полным списком (заголовки и описания пиши строго по commit_rules из контекста), '
        + (full ? 'затем set_merge_request с заголовком (одна строка) и описанием МР по шаблону из контекста (mr.template; он подставит остальное: целевую ветку, ревьюеров, исполнителей), ' : '') + 'затем finish_commits. '
        + (single ? 'Все изменения — ровно один коммит. ' : 'Сколько коммитов сделать, решай сам: по одному на логически отдельное изменение, мелочи не дроби. ')
        + 'При ошибке исправь список. Файлы и git через shell не изменяй. Коммиты выполняет сервер Plangent; push выполняет пользователь после подтверждения. Не добавляй атрибуцию агента.' },
    });
    if (session.role !== 'committer' || session.policy !== 'read-only') throw new CodeError('Invalid committer session');
    updateFinish(run.id, { session_id: session.id });
    await prompt(session.id, [{ type: 'text', text: run.note ? 'Переделай' + (full ? ' коммиты и МР' : ' коммиты') + ': ' + run.note
      : single ? 'Оформи все изменения одним коммитом' + (full ? ', напиши МР' : '') + ' и передай на подтверждение.' : 'Разбей изменения на осмысленные коммиты' + (full ? ', напиши МР' : '') + ' и передай на подтверждение.' }]);
  }
  /** The text the user confirms with the commits: only the full cycle has one. */
  function validateMr(title: unknown, description: unknown): FinishMrDraft {
    if (typeof title !== 'string' || !title.trim() || title.length > 1000 || /[\r\n\0]/.test(title)) throw new CodeError('Заголовок МР — одна непустая строка');
    if (typeof description !== 'string' || description.length > 100000) throw new CodeError('Некорректное описание МР');
    return { title: title.trim(), description };
  }
  /** The agent (while it proposes the commits) or the user (while they confirm) sets the MR text; nothing is created yet. */
  async function setMergeRequest(id: string, title: unknown, description: unknown) {
    const draft = validateMr(title, description);
    const run = getFinish(id);
    if (final(run) || run.scenario !== 'full' || !['commits', 'confirmation'].includes(run.stage)) throw new CodeError('МР можно менять до подтверждения, только в полном цикле', 409);
    return updateFinish(id, { mr_draft: draft });
  }
  /** After the push: creates the MR from the confirmed text; a failure leaves the run at this stage so «Повторить» retries it. */
  async function publishMr(run: FinishRun) {
    if (!run.mr_draft) throw new CodeError('Нет текста МР. Откатите коммиты и начните заново', 409);
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
    if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
    if (!input || !['nothing','commits','push','full'].includes(input.scenario)) throw new CodeError('Invalid finish scenario');
    if (input.scenario === 'nothing') return null;
    if (input.task_id && getTask(input.task_id)?.project_id !== projectId) throw new CodeError('Task not found', 404);
    const defaults = effectiveGitSettings(projectId).values;
    gitAgent(projectId);
    if (input.commitMode !== undefined && !['single', 'split'].includes(input.commitMode)) throw new CodeError('Invalid commit mode');
    if (input.scenario === 'full' && (typeof input.targetBranch !== 'string' || !input.targetBranch.trim())) throw new CodeError('Выберите целевую ветку');
    const scenario = input.scenario;
    if (scenario === 'full') await resolveHost(projectId).catch(error => { throw new CodeError('«Полный цикл» недоступен без подключения к хостингу: ' + (error instanceof Error ? error.message : failure(error))); });
    for (const key of ['targetBranch', 'branchName', 'task_id'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'string') throw new CodeError('Invalid ' + key);
    }
    const params: FinishOptions = {
      scenario, task_id: input.task_id, branchName: input.branchName,
      includeDescription: input.includeDescription ?? defaults.include_description,
      includeCoauthors: input.includeCoauthors ?? false, coauthors: input.coauthors,
      targetBranch: input.targetBranch || defaults.base_branch, commitMode: input.commitMode ?? 'split',
    };
    // Validate explicit flags and human coauthors before touching Git.
    assembleCommitMessage({ title: 'validate', ...params });
    return serializeGit(project.repo_path, async () => {
      assertRepositoryIdle(projectId);
      await assertNoGitOperation(project.repo_path);
      if (activeFinish(projectId)) throw new CodeError('В проекте уже идёт завершение', 409);
      const info = await repositoryInfo(project.repo_path);
      if (!info?.head || !info.branch) throw new CodeError('Нужна локальная ветка с исходным коммитом');
      if ((await changedFiles(project.repo_path)).some(c => c.status === 'U')) throw new CodeError('Разрешите конфликты во внешнем клиенте');
      const tree = await snapshot(project.repo_path);
      if (!tree || !(await treeChanges(project.repo_path, info.head, tree)).changes.length) throw new CodeError('Нет изменений для завершения');
      const target = params.targetBranch?.replace(/^origin\//, '');
      if (info.branch === target && !params.branchName) throw new CodeError('Создайте рабочую ветку: укажите branchName');
      const now = new Date().toISOString();
      let run = insertFinish({ id: randomUUID(), project_id: projectId, task_id: input.task_id ?? null, scenario, options: params,
        base_head: info.head, branch: info.branch, snapshot_tree: tree, stage: 'branch', status: 'running', commits: [],
        session_id: null, note: '', error: '', output: '', pushed: false, mr_url: null, mr_draft: null, created_at: now, updated_at: now });
      try {
        if (params.branchName) {
          await createBranch(project.repo_path, params.branchName, info.branch, optionsFor(run));
          run = updateFinish(run.id, { branch: params.branchName });
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
  async function setCommits(id: string, proposed: unknown, generated = false, overrideForbidden = false) {
    return locked(id, async (run, root) => {
      if (!['commits','confirmation'].includes(run.stage)) throw new CodeError('Коммиты недоступны на этом этапе');
      if (!generated && run.stage !== 'confirmation') throw new CodeError('Дождитесь подтверждения');
      const changes = (await treeChanges(root, run.base_head, run.snapshot_tree)).changes;
      validateCommitFiles(proposed, changes.map(c => c.path));
      if (generated && run.options.commitMode === 'single' && proposed.length !== 1) throw new CodeError('Нужен ровно один коммит со всеми файлами');
      const settings = effectiveGitSettings(run.project_id).values;
      const list: FinishCommit[] = proposed.map(item => {
        const raw = [item.title, run.options.includeDescription ? item.body : ''].filter(Boolean).join('\n\n');
        const text = generated ? cleanCommitMessage(raw, settings).trim() : raw;
        const [title, ...body] = text.split('\n');
        const data = { files: [...item.files], title, body: run.options.includeDescription ? body.join('\n').trim() : '' };
        const message = assembleCommitMessage({ ...data, ...run.options });
        if ((generated ? validateCommitMessage(message, settings) : inspectCommitMessage({ ...data, ...run.options }, settings).violations).some(v => v.kind === 'forbidden') && (generated || !overrideForbidden))
          throw new CodeError('Запрещённая атрибуция в сообщении коммита');
        return data;
      });
      const expected = await unchanged(run, root, true);
      updateFinish(id, { status: 'running', error: '', output: '' });
      try {
        await resetForReassembly(root, run.base_head, expected, optionsFor(run));
        // Persist every SHA so a hook failure remains recoverable.
        run = updateFinish(id, { commits: [] });
        for (const data of list) {
          const paths = data.files.flatMap(file => { const change = changes.find(c => c.path === file)!; return change.originalPath ? [change.originalPath, file] : [file]; });
          await stage(root, paths, optionsFor(run));
          await commit(root, { ...data, ...run.options }, () => effectiveGitSettings(run.project_id).values, optionsFor(run), overrideForbidden && !generated);
          const sha = (await repositoryInfo(root))!.head!;
          run = updateFinish(id, { commits: [...run.commits, { ...data, sha }] });
          if (await snapshot(root) !== run.snapshot_tree) throw new CodeError('Хук изменил рабочие файлы. Проверьте изменения во внешнем клиенте');
        }
        return updateFinish(id, { status: run.stage === 'confirmation' ? 'waiting' : 'running', error: '' });
      } catch (error) { updateFinish(id, { status: 'error', error: failure(error) }); throw error; }
    });
  }
  async function finishCommits(id: string) {
    return locked(id, async (run, root) => {
      if (!run.commits.length || run.commits.some(c => !c.sha)) throw new CodeError('Сначала создайте все коммиты');
      if (run.scenario === 'full' && !run.mr_draft) throw new CodeError('Сначала вызовите set_merge_request: напишите заголовок и описание МР');
      await unchanged(run, root);
      const changes = (await treeChanges(root, run.base_head, run.snapshot_tree)).changes;
      validateCommitFiles(run.commits, changes.map(c => c.path));
      const next = updateFinish(id, { ...transition(run, 'commits_ready'), error: '' });
      notify(next, 'Коммиты ждут подтверждения'); return next;
    });
  }
  async function revise(id: string, note: string) {
    if (typeof note !== 'string' || !note.trim() || note.length > 100000) throw new CodeError('Введите замечание агенту');
    return locked(id, async (run, root) => {
      if (run.status !== 'waiting' && !(run.status === 'error' && ['commits','confirmation'].includes(run.stage))) throw new CodeError('Дождитесь завершения работы агента');
      if (run.session_id && ['starting','thinking'].includes(getSession(run.session_id).status)) throw new CodeError('Агент заканчивает текущий ответ');
      await unchanged(run, root, true);
      if (run.session_id && getSession(run.session_id).status === 'error') await close(run.session_id);
      run = updateFinish(id, { ...(run.stage === 'commits' ? { status: 'running' as const } : transition(run, 'revise')), note: note.trim(), error: '' });
      await beginAgent(run); return getFinish(id);
    });
  }
  async function accept(id: string) {
    return locked(id, async (run, root) => {
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
      if (run.stage === 'push') {
        const info = await repositoryInfo(root), target = run.options.targetBranch?.replace(/^origin\//, '');
        if (!info?.branch || info.branch === target) throw new CodeError('Push в целевую ветку запрещён');
        await push(root, optionsFor(run));
        run = updateFinish(id, { ...transition(run, 'push_done'), pushed: true });
        if (run.stage === 'mr') return publishMr(run);
      }
      if (run.session_id) { await close(run.session_id).catch(() => {}); updateSession(run.session_id, { status: 'complete' }); }
      notify(run, 'Завершение выполнено'); return run;
    });
  }
  async function rollback(id: string) {
    const initial = getFinish(id);
    // Stop the committer first so no queued set_commits can race the reset.
    if (initial.session_id) { await close(initial.session_id); updateSession(initial.session_id, { status: 'complete' }); }
    return locked(id, async (run, root) => {
      const expected = await unchanged(run, root, true);
      if (run.stage === 'push' && run.status === 'running') throw new CodeError('Дождитесь завершения push');
      await resetForReassembly(root, run.base_head, expected, optionsFor(run));
      return updateFinish(id, { ...transition(run, 'cancel'), error: '' });
    });
  }
  function agentRun(session: AgentSession, stages: FinishRun['stage'][] = ['commits']) {
    const id = session.metadata.finish_id;
    if (session.role !== 'committer' || session.policy !== 'read-only' || typeof id !== 'string') throw new CodeError('Invalid committer');
    const run = getFinish(id);
    if (run.session_id !== session.id || run.project_id !== session.project_id || final(run) || !stages.includes(run.stage)) throw new CodeError('Сессия не управляет этим завершением');
    return id;
  }
  return { start, context, setCommits, finishCommits, setMergeRequest, revise, accept, rollback, agentRun,
    cancelOperation(id: string) { controllers.get(id)?.abort(); },
  };
}
let service: ReturnType<typeof createFinishService> | undefined;
export const finishes = () => service ??= createFinishService();
// Adapter failures remain visible after the HTTP request that started the run.
sessionSignals.on('error-state', (sessionId: string, reason: string) => {
  const row = getDb().prepare("SELECT id FROM finish_runs WHERE session_id=? AND status NOT IN ('complete','cancelled')").get(sessionId) as { id: string } | undefined;
  if (row) {
    const run = updateFinish(row.id, { status: 'error', error: reason });
    broadcast({ type: 'finish:notification', projectId: run.project_id, runId: run.id, title: 'Ошибка завершения работ', message: reason });
  }
});
