import { OrchestratorQueueSession, TaskQueue } from '../../models';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getAgent } from '../agents';
import { getLatestPlan, createPlan, parsePlanSteps, setStepDone, updatePlan } from './plans';
import { createRun, finishRun } from '../runs';
import { updateTask } from '../tasks';
import { resolvePlanTemplate } from '../library/plan-template';
import { buildPrompt, EXECUTION_REPORT } from './prompts';
import { captureTaskBaseCommit } from '../tasks/base-commit';
import { createSession as createChat, getSession as getChat, updateSession as updateChat } from '../agent-sessions/sessions';
import { sendPrompt, closeSession, cancelSession as cancelChat, enableExecution, sessionSignals } from '../agent-sessions/acp-host';
import { getPlanFilePath } from './task-files';
import { materializePlanFile, watchPlanFile, stopWatchPlanFile } from './plan-file';
import { archiveFinished, isActive, repeatReview, saveQueue } from './queue';
import { broadcast } from '../../core/shared/events';
import path from 'path';
import { launchTaskReview, taskReviewCount } from './task-review';

// Per-task orchestrator of a running (or paused) queue
const active = new Map<string, Orchestrator>();
sessionSignals.on('turn_end', (id: string) => {
  const chat = getChat(id);
  if (chat.task_id) void active.get(chat.task_id)?.onChatTurnEnd(id).catch(e => active.get(chat.task_id!)?.fail(String(e)));
});
for (const signal of ['help', 'error-state']) sessionSignals.on(signal, (id: string, reason: string) => {
  const chat = getChat(id);
  const orch = chat.task_id ? active.get(chat.task_id) : undefined;
  const session = orch?.sessions().find(s => s.sessionId === id);
  if (orch && session && isActive(session)) {
    if (signal === 'error-state' && session.kind === 'review') void orch.failReview(session, reason);
    else orch.waitForDeveloper(session, reason, false);
  }
});
// The developer answered (message or permission): the session is working again.
sessionSignals.on('thinking', (id: string) => {
  const chat = getChat(id);
  const orch = chat.task_id ? active.get(chat.task_id) : undefined;
  const session = orch?.sessions().find(s => s.sessionId === id);
  if (orch && session && (session.status === 'waiting_for_developer' || session.status === 'ready_for_execution')) orch.resumeWork(session, chat.policy === 'read-only');
});

// A queue session's agents were shut down on purpose: their chats must not keep showing
// "thinking" or count as waiting for the developer.
export function markChatsStopped(session: OrchestratorQueueSession, reason: string): void {
  for (const id of [session.sessionId]) {
    if (!id) continue;
    try {
      if (['starting', 'thinking', 'waiting', 'ready'].includes(getChat(id).status)) updateChat(id, { status: 'complete', reason });
    } catch { /* chat deleted */ }
  }
}

export function getOrchestrator(taskId: string): Orchestrator | undefined {
  return active.get(taskId);
}

export class Orchestrator {
  constructor(readonly queue: TaskQueue) {
    active.set(queue.taskId, this);
  }

  sessions(): OrchestratorQueueSession[] {
    return this.queue.stages.flatMap(st => st.sessions);
  }

  private save(): void { saveQueue(this.queue); }

  /** "- p2. Step text" lines for the visible chat messages. */
  private stepList(points: string[]): string {
    const steps = parsePlanSteps(getLatestPlan(this.queue.taskId)?.content ?? '');
    return points.map(p => `- ${p}. ${steps.find(s => s.id === p)?.text ?? ''}`.trimEnd()).join('\n');
  }

  // Queue events carry the task key and project so the client can notify about any task, not only the open one.
  private emit(event: { type: string; [key: string]: unknown }): void {
    const { taskId, projectId } = this.queue;
    broadcast({ ...event, taskId, projectId, taskKey: getTask(taskId)?.key });
  }

  // Launch the queue from its first unfinished stage. Sessions that were stopped or failed
  // run again, but only for their points that are still not done in the plan.
  async start(): Promise<void> {
    await captureTaskBaseCommit(this.queue.taskId);
    const done = new Set(parsePlanSteps(getLatestPlan(this.queue.taskId)?.content ?? '').filter(s => s.done && s.id).map(s => s.id!));
    for (const s of this.sessions()) {
      if (s.status === 'complete') continue;
      if (s.kind === 'review') { Object.assign(s, { status: 'queued', reason: undefined }); continue; }
      const pending = (s.points ?? []).filter(p => !done.has(p));
      if (!pending.length) { s.status = 'complete'; continue; }
      Object.assign(s, { points: pending, status: 'queued', reason: undefined });
    }
    archiveFinished(this.queue);
    Object.assign(this.queue, { status: 'running', stageIndex: 0, pauseRequested: false, reason: undefined });
    updateTask(this.queue.taskId, { status: 'in_progress' });
    this.emit({ type: 'task_status', status: 'in_progress' });
    await this.runStage();
  }

  // Start every queued session of the current stage, skipping stages with nothing left to do.
  private async runStage(): Promise<void> {
    const { stages } = this.queue;
    while (this.queue.stageIndex < stages.length && !stages[this.queue.stageIndex].sessions.some(s => s.status === 'queued')) this.queue.stageIndex++;
    if (this.queue.stageIndex >= stages.length) return this.finish();
    const stage = stages[this.queue.stageIndex];
    this.save();
    await Promise.all(stage.sessions.filter(s => s.status === 'queued').map(s => this.launchSession(s)));
  }

  async onChatTurnEnd(id: string): Promise<void> {
    const session = this.sessions().find(s => s.sessionId === id);
    if (!session || !isActive(session)) return;
    const chat = getChat(id);
    if (session.kind === 'review') {
      if (chat.status === 'waiting') { this.waitForDeveloper(session, chat.reason, false); return; }
      if (chat.status === 'error') { await this.failReview(session, chat.reason); return; }
      if (chat.status !== 'complete') updateChat(id, { status: 'complete' });
      session.status = 'running'; await this.completeSession(session); return;
    }
    if (chat.policy === 'read-only') { await this.markReadyForExecution(session.id); return; }
    if (chat.status === 'complete') { session.status = 'running'; await this.completeSession(session); }
    else this.waitForDeveloper(session, chat.reason || 'Агент остановился без отчёта');
  }

  // The session needs the developer. The executor chat is flagged `waiting` too (unless the
  // agent already did it itself), which is what raises the system notification on the client.
  waitForDeveloper(session: OrchestratorQueueSession, reason: string, flagChat = true): void {
    session.status = 'waiting_for_developer'; session.reason = reason;
    if (flagChat && session.sessionId) updateChat(session.sessionId, { status: 'waiting', reason });
    this.save();
    this.emit({ type: 'session_waiting', sessionId: session.id, message: reason });
  }

  resumeWork(session: OrchestratorQueueSession, readOnly: boolean): void {
    session.status = readOnly ? 'reviewing' : 'running';
    session.reason = undefined;
    this.save();
  }

  async failReview(session: OrchestratorQueueSession, reason: string): Promise<void> {
    if (!isActive(session)) return;
    session.status = 'failed'; session.reason = reason;
    if (session.sessionId) session.remarks = taskReviewCount(session.sessionId);
    if (session.runId) finishRun(session.runId, 'failed', reason);
    this.save();
    this.emit({ type: 'session_failed', sessionId: session.id, reason });
    await this.maybeAdvance();
  }

  async restartSession(id: string): Promise<void> {
    if (repeatReview(this.queue, id)) { this.save(); return; }
    const session = this.sessions().find(s => s.id === id);
    if (!session || session.status === 'complete') return;
    await this.killSessionProcess(session);
    markChatsStopped(session, 'Шаг начат заново в новом чате');
    if (session.runId) finishRun(session.runId, 'interrupted');
    session.reason = undefined;
    await this.launchSession(session);
  }

  private async launchSession(session: OrchestratorQueueSession): Promise<void> {
    const { taskId, projectId } = this.queue;
    const task = getTask(taskId);
    const project = getProject(projectId);
    const baseAgent = getAgent(session.agentId);
    const agent = baseAgent && {
      ...baseAgent,
      model: session.model || baseAgent.model,
      reasoning_effort: session.reasoningEffort || baseAgent.reasoning_effort,
    };

    if (!task || !project || !agent) {
      session.status = 'failed';
      session.reason = 'Не найдены задача, проект или агент';
      this.save();
      this.emit({ type: 'session_failed', sessionId: session.id, reason: session.reason });
      await this.maybeAdvance();
      return;
    }

    if (session.kind === 'review') {
      session.status = 'reviewing';
      session.remarks = 0;
      session.reviewId = undefined;
      session.sessionId = undefined;
      session.runId = undefined;
      try {
        await launchTaskReview(this.queue, session, agent, () => this.save());
      } catch (error) {
        await this.failReview(session, String(error));
      }
      return;
    }

    // Ensure plan file exists
    let plan = getLatestPlan(taskId);
    if (!plan) {
      plan = createPlan({ task_id: taskId, content: '' });
    }
    const planRelPath = path.relative(project.repo_path, getPlanFilePath(project.repo_path, task.key));
    materializePlanFile(task, plan, project.repo_path);
    watchPlanFile(task, plan.id, project.repo_path);

    // Build session-specific prompt
    const points = session.points ?? [];
    const purpose = session.queueMode === 'review_first' ? 'preflight' : 'execute';
    const prompt = buildPrompt({
      taskId: task.id, repoPath: project.repo_path,
      projectName: project.name,
      taskKey: task.key,
      taskTitle: task.title ?? undefined,
      taskDescription: task.description ?? undefined,
      planContent: plan.content,
      planFilePath: planRelPath,
      planTemplate: resolvePlanTemplate(projectId),
      points: session.points ?? [],
      purpose,
      runHistory: [],
    });

    // Create run record
    const run = createRun({
      task_id: taskId,
      plan_id: plan.id,
      agent_id: agent.id,
      agent_name: agent.name,
    });

    const chat = createChat({ project_id: projectId, task_id: taskId, run_id: run.id,
      // Plangent's protocol and task context go as a hidden briefing; the chat shows only the short request.
      metadata: { reasoningEffort: agent.reasoning_effort, briefing: prompt + (session.queueMode === 'review_first' ? '' : EXECUTION_REPORT) },
      agent_id: agent.id, model: agent.model, step_ids: points, role: 'executor',
      policy: session.queueMode === 'review_first' ? 'read-only' : session.permissionPolicy, title: `${task.key} · ${points.join(', ')}` });
    session.runId = run.id;
    session.sessionId = chat.id;
    session.mode = 'acp';
    session.status = session.queueMode === 'review_first' ? 'reviewing' : 'running';
    this.save();
    this.emit({ type: 'session_started', sessionId: session.id, runId: run.id, terminalSessionId: chat.id, mode: 'acp', points: session.points });
    try {
      await sendPrompt(chat.id, [{ type: 'text', text: session.queueMode === 'review_first'
        ? `Изучи шаги и расскажи, как будешь их выполнять. Пока ничего не меняй:\n${this.stepList(session.points ?? [])}`
        : `Выполни шаги:\n${this.stepList(session.points ?? [])}` }]);
    } catch (err) {
      this.waitForDeveloper(session, String(err));
    }
  }

  // Mark a running session complete and advance the queue. The agent process is
  // intentionally kept alive after completion so the developer can ask follow-up
  // questions or correct the result in the same context.
  private async completeSession(session: OrchestratorQueueSession): Promise<void> {
    if (session.status !== 'running') return;
    session.status = 'complete';
    session.reason = undefined;
    const plan = getLatestPlan(this.queue.taskId), task = getTask(this.queue.taskId), project = getProject(this.queue.projectId);
    if (session.kind === 'review' && session.sessionId) session.remarks = taskReviewCount(session.sessionId);
    if (session.kind !== 'review' && plan && task && project) {
      let content = plan.content;
      for (const step of parsePlanSteps(content)) if (step.id && (session.points ?? []).includes(step.id)) content = setStepDone(content, step.index, true);
      materializePlanFile(task, updatePlan(plan.id, content, plan)!, project.repo_path);
      broadcast({ type: 'plan_updated', taskId: task.id });
    }
    if (session.runId) finishRun(session.runId, 'completed', session.sessionId ? getChat(session.sessionId).reason : undefined);
    this.save();
    this.emit({ type: 'session_complete', sessionId: session.id, runId: session.runId });
    await this.maybeAdvance();
  }

  private async killSessionProcess(session: OrchestratorQueueSession): Promise<void> {
    if (session.sessionId) await closeSession(session.sessionId);
  }

  // Developer accepts a session as done although the agent did not report it
  // (from `running` or `waiting_for_developer`). The agent stays alive.
  async manualComplete(sessionId: string): Promise<void> {
    const session = this.sessions().find(s => s.id === sessionId);
    if (!session || !isActive(session)) return;
    if (session.sessionId) { await cancelChat(session.sessionId); updateChat(session.sessionId, { status: 'complete' }); }
    session.status = 'running';
    await this.completeSession(session);
  }

  async executeReadySession(sessionId: string): Promise<void> {
    const session = this.sessions().find(s => s.id === sessionId);
    if (!session || session.queueMode !== 'review_first') return;
    if (session.status !== 'reviewing' && session.status !== 'ready_for_execution' && session.status !== 'waiting_for_developer') return;
    if (!session.sessionId || !session.mode) throw new Error('No live preflight session to continue');

    const task = getTask(this.queue.taskId);
    const project = getProject(this.queue.projectId);
    if (!task || !project) throw new Error('Missing task or project');

    const plan = getLatestPlan(this.queue.taskId);
    const planRelPath = path.relative(project.repo_path, getPlanFilePath(project.repo_path, task.key));
    const prompt = buildPrompt({
      taskId: task.id, repoPath: project.repo_path,
      projectName: project.name,
      taskKey: task.key,
      taskTitle: task.title ?? undefined,
      taskDescription: task.description ?? undefined,
      planContent: plan?.content,
      planFilePath: planRelPath,
      points: session.points ?? [],
      purpose: 'execute',
      runHistory: [],
    });

    session.status = 'running';
    session.reason = undefined;
    this.save();
    await enableExecution(session.sessionId, session.permissionPolicy);
    // The execution rules replace the preflight ones and go out hidden with the next message.
    updateChat(session.sessionId, { metadata: { ...getChat(session.sessionId).metadata, briefing: prompt + EXECUTION_REPORT, briefed: false } });
    await sendPrompt(session.sessionId, [{ type: 'text', text: 'Приступай к выполнению этих шагов.' }]);
  }

  // A preflight ("обсудить") session finished its read-only pass and waits for the developer.
  async markReadyForExecution(sessionId: string): Promise<void> {
    const session = this.sessions().find(s => s.id === sessionId);
    if (!session || session.queueMode !== 'review_first') return;
    if (session.status !== 'reviewing' && session.status !== 'waiting_for_developer') return;
    session.status = 'ready_for_execution';
    session.reason = 'Агент изучил шаги и ждёт команды на выполнение';
    if (session.sessionId) updateChat(session.sessionId, { status: 'waiting', reason: session.reason });
    this.save();
    this.emit({ type: 'session_ready_for_execution', sessionId: session.id, message: session.reason });
  }

  // Developer skips one session: it stops and the rest of the queue goes on.
  async skipSession(sessionId: string): Promise<void> {
    const session = this.sessions().find(s => s.id === sessionId);
    if (!session || !isActive(session)) return;
    await this.killSessionProcess(session);
    markChatsStopped(session, 'Шаг пропущен');
    if (session.runId) finishRun(session.runId, 'interrupted');
    session.status = 'failed';
    session.reason = 'Пропущен разработчиком';
    this.save();
    await this.maybeAdvance();
  }

  // Pause once the current stage is done (toggle).
  requestPause(on: boolean): void {
    if (this.queue.status !== 'running') return;
    this.queue.pauseRequested = on;
    this.save();
  }

  async resume(): Promise<void> {
    if (this.queue.status !== 'paused') return;
    this.queue.status = 'running';
    this.queue.stageIndex++;
    await this.runStage();
  }

  // Stop the whole queue. Finished work stays finished; sessions in flight become `stopped`
  // and run again (for their undone points) when the queue is relaunched.
  async stop(reason = 'Остановлена разработчиком'): Promise<void> {
    active.delete(this.queue.taskId);
    const live = this.sessions().filter(s => isActive(s) || (s.kind === 'review' && s.status === 'queued'));
    for (const s of live) {
      s.status = 'stopped';
      s.reason = undefined;
      if (s.runId) finishRun(s.runId, 'interrupted');
    }
    Object.assign(this.queue, { status: 'stopped', pauseRequested: false, reason });
    this.save();
    this.stopWatching();
    await Promise.all(live.map(s => this.killSessionProcess(s)));
    for (const s of live) markChatsStopped(s, 'Очередь остановлена');
  }

  // Once every session of the stage is done, go on — or pause if the stage asks for it.
  private async maybeAdvance(): Promise<void> {
    if (this.queue.status !== 'running') return;
    const stage = this.queue.stages[this.queue.stageIndex];
    if (!stage || stage.sessions.some(isActive) || stage.sessions.some(s => s.status === 'queued')) return;
    const hasNext = this.queue.stages.slice(this.queue.stageIndex + 1).some(st => st.sessions.some(s => s.status === 'queued'));
    if (hasNext && (stage.pauseAfter || this.queue.pauseRequested)) {
      // The stage's agents stay alive so the developer can talk to them during the review.
      Object.assign(this.queue, { status: 'paused', pauseRequested: false });
      this.save();
      this.emit({ type: 'queue_paused', stageIndex: this.queue.stageIndex });
      return;
    }
    this.queue.stageIndex++;
    await this.runStage();
  }

  private stopWatching(): void {
    const task = getTask(this.queue.taskId);
    if (task) stopWatchPlanFile(task.id);
  }

  private finish(): void {
    active.delete(this.queue.taskId);
    const failed = this.sessions().filter(s => s.status === 'failed').length;
    const reviewed = this.sessions().filter(s => s.kind === 'review');
    const remarks = reviewed.length ? reviewed.reduce((n, s) => n + (s.remarks ?? 0), 0) : undefined;
    Object.assign(this.queue, { status: 'finished', pauseRequested: false, reason: undefined, stageIndex: 0 });
    archiveFinished(this.queue);
    this.save();
    this.stopWatching();
    this.emit({ type: 'queue_finished', failed, remarks });
  }

  fail(reason: string): void {
    void this.stop(reason).then(() => {
      this.queue.status = 'failed';
      this.save();
      this.emit({ type: 'run_failed', reason });
    });
  }
}
