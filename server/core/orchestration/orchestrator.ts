import { v4 as uuidv4 } from 'uuid';
import {
  OrchestratorQueueSession,
  OrchestratorState,
} from '../../models';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getAgent } from '../agents';
import { getLatestPlan, createPlan, parsePlanSteps, setStepDone, updatePlan } from './plans';
import { createRun, finishRun } from '../runs';
import { updateTask } from '../tasks';
import { resolvePlanTemplate } from '../library/plan-template';
import { buildPrompt, EXECUTION_REPORT } from './prompts';
import { createSession as createChat, getSession as getChat, updateSession as updateChat, history } from '../agent-sessions/sessions';
import { sendPrompt, closeSession, cancelSession as cancelChat, enableExecution, sessionSignals } from '../agent-sessions/acp-host';
import { materializePlanFile, watchPlanFile, stopWatchPlanFile } from './plan-file';
import { broadcast } from '../../core/shared/events';
import path from 'path';

export interface QueueSessionInput {
  points: string[];
  agentId: string;
  parallelGroup: string | null;
  queueMode?: 'execute' | 'review_first';
  pauseAfter?: boolean;
  // Per-run override of the agent's configured model/reasoning_effort — leave
  // unset to use whatever the Agent row (server/core/agents) is configured with.
  model?: string;
  reasoningEffort?: string;
  reviewerId?: string;
  maxReviewRounds?: number;
}

// Group queued sessions into execution steps. A filled parallelGroup means
// "start this session together with the neighboring parallel sessions".
function buildSteps(sessions: OrchestratorQueueSession[]): OrchestratorQueueSession[][] {
  const steps: OrchestratorQueueSession[][] = [];
  let i = 0;
  while (i < sessions.length) {
    const current = sessions[i];
    if (!current.parallelGroup) {
      steps.push([current]);
      i++;
    } else {
      const group = [current];
      i++;
      while (i < sessions.length && sessions[i].parallelGroup) {
        group.push(sessions[i]);
        i++;
      }
      steps.push(group);
    }
  }
  return steps;
}


// Per-task orchestrator singleton
const active = new Map<string, Orchestrator>();
sessionSignals.on('turn_end', (id: string) => {
  const chat = getChat(id);
  if (chat.task_id) void active.get(chat.task_id)?.onChatTurnEnd(id).catch(e => active.get(chat.task_id!)?.fail(String(e)));
});
for (const signal of ['help', 'error-state']) sessionSignals.on(signal, (id: string, reason: string) => {
  const chat = getChat(id);
  const orch = chat.task_id ? active.get(chat.task_id) : undefined;
  const session = orch?.state.sessions.find(s => s.sessionId === id || s.reviewSessionId === id);
  if (session && !['complete', 'failed'].includes(session.status)) {
    session.status = 'waiting_for_developer'; session.reason = reason;
    broadcast({ type: 'session_waiting', taskId: chat.task_id, sessionId: session.id, message: reason });
  }
});

export function getOrchestrator(taskId: string): Orchestrator | undefined {
  return active.get(taskId);
}

export function removeOrchestrator(taskId: string): void {
  active.delete(taskId);
}


export class Orchestrator {
  async onChatTurnEnd(id: string): Promise<void> {
    if (this.state.status === 'failed') return;
    const session = this.state.sessions.find(s => s.sessionId === id || s.reviewSessionId === id);
    if (!session || ['complete', 'failed'].includes(session.status)) return;
    const chat = getChat(id);
    if (session.reviewSessionId === id) {
      if (chat.status === 'complete' && chat.reason === 'approved') {
        session.status = 'running'; await this.completeSession(session); return;
      }
      if (chat.status === 'complete' && (session.reviewRound ?? 0) < (session.maxReviewRounds ?? 2)) {
        const findings = history(id).filter(e => e.type === 'add_finding').map(e => e.payload);
        updateChat(session.sessionId!, { status: 'ready' }); session.status = 'running';
        await sendPrompt(session.sessionId!, [{ type: 'text', text: `Исправь замечания ревью:\n${JSON.stringify(findings)}${EXECUTION_REPORT}` }]); return;
      }
      session.status = 'waiting_for_developer'; session.reason = 'Ревью требует внимания: нет вердикта или достигнут предел кругов';
      updateChat(session.sessionId!, { status: 'waiting', reason: session.reason });
      broadcast({ type: 'session_waiting', taskId: this.state.taskId, sessionId: session.id, message: session.reason }); return;
    }
    if (chat.policy === 'read-only') { await this.markReadyForExecution(session.id); return; }
    if (chat.status === 'complete' && session.reviewerId) {
      const reviewer = createChat({ project_id: this.state.projectId, task_id: this.state.taskId,
        agent_id: session.reviewerId, step_ids: session.points, role: 'reviewer', policy: 'read-only', title: `Ревью · ${session.points.join(', ')}` });
      updateChat(reviewer.id, { metadata: { reviewContext: history(id).filter(e => ['assistant', 'complete_step'].includes(e.type)).map(e => e.payload) } });
      session.reviewSessionId = reviewer.id; session.reviewRound = (session.reviewRound ?? 0) + 1; session.status = 'reviewing';
      broadcast({ type: 'review_started', taskId: this.state.taskId, sessionId: session.id, reviewSessionId: reviewer.id });
      await sendPrompt(reviewer.id, [{ type: 'text', text: `Review changes for steps ${session.points.join(', ')}. Do not edit files. Use get_review_context, inspect the files, report actionable findings using add_finding and finish with submit_review (approved or changes_requested).` }]); return;
    }
    if (chat.status === 'complete') { session.status = 'running'; await this.completeSession(session); }
    else {
      session.status = 'waiting_for_developer'; session.reason = chat.reason || 'Агент остановился без отчёта';
      broadcast({ type: 'session_waiting', taskId: this.state.taskId, sessionId: session.id, message: session.reason });
    }
  }
  async restartSession(id: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === id);
    if (!session || session.status === 'complete') return;
    await this.killSessionProcess(session);
    if (session.runId) finishRun(session.runId, 'interrupted');
    session.reviewSessionId = undefined; session.reviewRound = 0;
    await this.launchSession(session);
  }
  readonly state: OrchestratorState;
  private steps: OrchestratorQueueSession[][];
  private stepIndex = 0;

  constructor(taskId: string, projectId: string, sessions: OrchestratorQueueSession[]) {
    this.state = {
      id: uuidv4(),
      taskId,
      projectId,
      sessions,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.steps = buildSteps(sessions);
    active.set(taskId, this);
  }

  async start(): Promise<void> {
    // Mark task in_progress
    updateTask(this.state.taskId, { status: 'in_progress' });
    broadcast({ type: 'task_status', taskId: this.state.taskId, status: 'in_progress' });
    await this.executeStep();
  }

  private async executeStep(): Promise<void> {
    if (this.stepIndex >= this.steps.length) {
      await this.finish();
      return;
    }
    const step = this.steps[this.stepIndex];
    await Promise.all(step.map(s => this.launchSession(s)));
  }

  private async launchSession(session: OrchestratorQueueSession): Promise<void> {
    const { taskId, projectId } = this.state;
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
      broadcast({ type: 'session_failed', taskId, sessionId: session.id, reason: 'Missing task/project/agent' });
      return;
    }

    // Ensure plan file exists
    let plan = getLatestPlan(taskId);
    if (!plan) {
      plan = createPlan({ task_id: taskId, content: '' });
    }
    const planRelPath = path.join('.plangent', `${task.key}.plan.md`);
    materializePlanFile(task, plan, project.repo_path);
    watchPlanFile(task, plan.id, project.repo_path);

    // Build session-specific prompt
    const purpose = session.queueMode === 'review_first' ? 'preflight' : 'execute';
    const prompt = buildPrompt({
      projectName: project.name,
      taskKey: task.key,
      taskTitle: task.title ?? undefined,
      taskDescription: task.description ?? undefined,
      planContent: plan.content,
      planFilePath: planRelPath,
      planTemplate: resolvePlanTemplate(projectId),
      points: session.points,
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
      metadata: { reasoningEffort: agent.reasoning_effort },
      agent_id: agent.id, model: agent.model, step_ids: session.points, role: 'executor',
      policy: session.queueMode === 'review_first' ? 'read-only' : 'allow-all', title: task.key + ' ? ' + session.points.join(', ') });
    session.runId = run.id;
    session.sessionId = chat.id;
    session.mode = 'acp';
    session.status = session.queueMode === 'review_first' ? 'reviewing' : 'running';
    broadcast({ type: 'session_started', taskId, sessionId: session.id, runId: run.id, terminalSessionId: chat.id, mode: 'acp', points: session.points });
    try {
      await sendPrompt(chat.id, [{ type: 'text', text: prompt + (session.queueMode === 'review_first' ? '' : EXECUTION_REPORT) }]);
    } catch (err) {
      session.status = 'waiting_for_developer';
      session.reason = String(err);
      broadcast({ type: 'session_waiting', taskId, sessionId: session.id, message: String(err) });
    }
  }

  // Mark a running session complete and advance the queue. The agent process is
  // intentionally kept alive after completion so the developer can reopen the
  // terminal, ask follow-up questions, or correct the result in the same context.
  private async completeSession(session: OrchestratorQueueSession): Promise<void> {
    if (session.status !== 'running') return;
    session.status = 'complete';
    const plan = getLatestPlan(this.state.taskId), task = getTask(this.state.taskId), project = getProject(this.state.projectId);
    if (plan && task && project) {
      let content = plan.content;
      for (const step of parsePlanSteps(content)) if (step.id && session.points.includes(step.id)) content = setStepDone(content, step.index, true);
      materializePlanFile(task, updatePlan(plan.id, content)!, project.repo_path);
      broadcast({ type: 'plan_updated', taskId: task.id });
    }
    if (session.runId) finishRun(session.runId, 'completed');
    broadcast({ type: 'session_complete', taskId: this.state.taskId, sessionId: session.id, runId: session.runId });
    await this.maybeAdvance();
  }

  // Kill the live agent process for a session (if still running) without touching its
  // run record. Used to tear down agents once the queue moves past their step.
  private async killSessionProcess(session: OrchestratorQueueSession): Promise<void> {
    if (session.sessionId) await closeSession(session.sessionId);
    if (session.reviewSessionId) await closeSession(session.reviewSessionId);
  }

  private async killStepAgents(step: OrchestratorQueueSession[]): Promise<void> {
    for (const s of step) await this.killSessionProcess(s);
  }

  private async killAllAgents(): Promise<void> {
    for (const s of this.state.sessions) await this.killSessionProcess(s);
  }

  // Developer marks a session as done (from either `running` or `waiting_for_developer`).
  // Used both to continue a session that stopped without checking every box, and to
  // rescue a session stuck in `running` (e.g. no completion signal arrived). The agent
  // stays alive (same as auto-completion) so a review pause can still talk to it.
  async manualComplete(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (session.status === 'complete' || session.status === 'failed') return;
    if (session.sessionId) { await cancelChat(session.sessionId); updateChat(session.sessionId, { status: 'complete' }); }
    if (session.reviewSessionId) await closeSession(session.reviewSessionId);
    session.status = 'complete';
    if (session.runId) finishRun(session.runId, 'completed');
    broadcast({ type: 'session_complete', taskId: this.state.taskId, sessionId: session.id, runId: session.runId });
    await this.maybeAdvance();
  }

  async executeReadySession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session || session.queueMode !== 'review_first') return;
    if (session.status !== 'reviewing' && session.status !== 'ready_for_execution' && session.status !== 'waiting_for_developer') return;
    if (!session.sessionId || !session.mode) throw new Error('No live preflight session to continue');

    const task = getTask(this.state.taskId);
    const project = getProject(this.state.projectId);
    if (!task || !project) throw new Error('Missing task or project');

    const plan = getLatestPlan(this.state.taskId);
    const planRelPath = path.join('.plangent', `${task.key}.plan.md`);
    const prompt = buildPrompt({
      projectName: project.name,
      taskKey: task.key,
      taskTitle: task.title ?? undefined,
      taskDescription: task.description ?? undefined,
      planContent: plan?.content,
      planFilePath: planRelPath,
      points: session.points,
      purpose: 'execute',
      runHistory: [],
    });

    session.status = 'running';
    this.state.status = 'running';
    broadcast({ type: 'queue_resumed', taskId: this.state.taskId });
    await enableExecution(session.sessionId);
    await sendPrompt(session.sessionId, [{ type: 'text', text: prompt + EXECUTION_REPORT }]);
  }

  async markReadyForExecution(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session || session.queueMode !== 'review_first') return;
    if (session.status !== 'reviewing' && session.status !== 'waiting_for_developer') return;
    session.status = 'ready_for_execution';
    this.state.status = 'paused';
    broadcast({
      type: 'session_ready_for_execution',
      taskId: this.state.taskId,
      sessionId: session.id,
      runId: session.runId,
      terminalSessionId: session.sessionId,
      message: 'Ознакомление отмечено готовым к выполнению.',
    });
  }

  // Backwards-compatible alias for the existing /advance endpoint.
  async manualAdvance(sessionId: string): Promise<void> {
    return this.manualComplete(sessionId);
  }

  // Developer cancels a session (queued, running or waiting). Frees the queue so the
  // step can advance instead of hanging forever on the cancelled session.
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (session.status === 'complete' || session.status === 'failed') return;
    await this.killSessionProcess(session);
    if (session.runId) finishRun(session.runId, 'interrupted');
    session.status = 'failed';
    if (this.state.status === 'paused') this.state.status = 'running';
    broadcast({ type: 'session_failed', taskId: this.state.taskId, sessionId: session.id, reason: 'Остановлена разработчиком' });
    await this.maybeAdvance();
  }

  // Resume after a pauseAfter checkpoint. Completed agents stay alive for manual
  // follow-up; explicit user actions are responsible for closing terminals.
  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;
    this.state.status = 'running';
    this.stepIndex++;
    broadcast({ type: 'queue_resumed', taskId: this.state.taskId });
    await this.executeStep();
  }

  // Advance to the next step once every session in the current step has reached a
  // terminal state. Honors per-session `pauseAfter` review checkpoints.
  private async maybeAdvance(): Promise<void> {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    const stepDone = step.every(s => s.status === 'complete' || s.status === 'failed');
    if (!stepDone) return;

    if (step.some(s => s.pauseAfter)) {
      // Keep this step's agents alive so the developer can interact with them
      // during review; they are torn down on resume().
      this.state.status = 'paused';
      broadcast({ type: 'queue_paused', taskId: this.state.taskId, stepIndex: this.stepIndex });
      return;
    }
    this.stepIndex++;
    await this.executeStep();
  }


  private async finish(): Promise<void> {
    this.state.status = 'finished';
    // Stop watcher keyed by task.key
    const task = getTask(this.state.taskId);
    if (task) stopWatchPlanFile(task.key);
    broadcast({ type: 'queue_finished', taskId: this.state.taskId });
    console.log(`[orchestrator] Queue finished for task ${this.state.taskId}`);
  }

  fail(reason: string): void {
    this.state.status = 'failed';
    void this.killAllAgents();
    broadcast({ type: 'run_failed', taskId: this.state.taskId, reason });
    active.delete(this.state.taskId);
  }

  getState(): OrchestratorState {
    return {
      ...this.state,
      sessions: this.state.sessions.map(s => ({ ...s })),
    };
  }
}
