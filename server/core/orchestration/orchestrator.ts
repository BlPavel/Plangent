import { v4 as uuidv4 } from 'uuid';
import {
  OrchestratorQueueSession,
  OrchestratorState,
} from '../../models';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getAgent } from '../agents';
import { getLatestPlan, createPlan, parsePlanSteps } from './plans';
import { createRun, finishRun } from '../runs';
import { updateTask } from '../tasks';
import { resolvePlanTemplate } from '../library/plan-template';
import { launchAgent, buildPrompt, deployClaudeStopHook, cleanupClaudeStopHook, killAgent, sendToAgent } from './agent-runtime';
import { materializePlanFile, watchPlanFile, stopWatchPlanFile, setPlanSyncListener } from './plan-file';
import { registerSession, removeSession, getSession } from '../sessions/session-registry';
import { broadcast } from '../../core/shared/events';
import path from 'path';

export interface QueueSessionInput {
  points: string[];
  agentId: string;
  parallelGroup: string | null;
  queueMode?: 'execute' | 'review_first';
  pauseAfter?: boolean;
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

const CALLBACK_URL = process.env.PLANGENT_URL ?? 'http://localhost:3000';

// Per-task orchestrator singleton
const active = new Map<string, Orchestrator>();

export function getOrchestrator(taskId: string): Orchestrator | undefined {
  return active.get(taskId);
}

export function removeOrchestrator(taskId: string): void {
  active.delete(taskId);
}

// When a plan file is synced to the DB, let the matching orchestrator check whether
// any running session has now completed all its assigned points.
setPlanSyncListener((taskId: string) => {
  const orch = active.get(taskId);
  if (orch) {
    orch.onPlanUpdated().catch(e => console.error('[orchestrator] onPlanUpdated error:', e));
  }
});

export class Orchestrator {
  readonly state: OrchestratorState;
  private steps: OrchestratorQueueSession[][];
  private stepIndex = 0;
  // Repo path where the (generic, env-driven) Claude Stop hook was deployed.
  // The hook is shared by every run in this repo, so it is cleaned up once when
  // the queue finishes — not per run.
  private hookRepoPath: string | null = null;

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
    const agent = getAgent(session.agentId);

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

    const sessionId = `plangent-${task.key.replace(/[^a-zA-Z0-9]/g, '-')}-${run.id.slice(0, 8)}`;

    // Extra env vars for callback
    const extraEnv: Record<string, string> = {
      ...(project.config.extra_env ?? {}),
      PLANGENT_RUN_ID: run.id,
      PLANGENT_PROJECT_ID: projectId,
      PLANGENT_TASK_ID: taskId,
      PLANGENT_CALLBACK_URL: CALLBACK_URL,
    };

    // Deploy Stop hook for Claude Code. The hook command is generic (it reads
    // $PLANGENT_RUN_ID etc. from the agent's env), so a single hook serves every
    // run in this repo — including parallel sessions — without clobbering.
    if (agent.id === 'agent-claude') {
      try {
        deployClaudeStopHook(project.repo_path, CALLBACK_URL);
        this.hookRepoPath = project.repo_path;
      } catch (e) {
        console.warn('[orchestrator] Could not deploy stop hook:', e);
      }
    }

    try {
      const result = await launchAgent(agent, project.repo_path, sessionId, extraEnv, prompt);
      session.runId = run.id;
      session.sessionId = sessionId;
      session.mode = result.mode;
      session.status = session.queueMode === 'review_first' ? 'reviewing' : 'running';

      registerSession(run.id, {
        sessionId,
        mode: result.mode,
        projectId,
        taskId,
      });

      broadcast({
        type: 'session_started',
        taskId,
        sessionId: session.id,
        runId: run.id,
        terminalSessionId: sessionId,
        mode: result.mode,
        points: session.points,
      });

      // Fallback: if no Stop hook fires within 5 minutes, surface a warning
      setTimeout(() => {
        if (session.status === 'running' || session.status === 'reviewing') {
          broadcast({
            type: 'session_no_signal',
            taskId,
            sessionId: session.id,
            runId: run.id,
            message: 'No completion signal received yet — agent may still be working or needs input.',
          });
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      session.status = 'failed';
      finishRun(run.id, 'failed', String(err));
      broadcast({ type: 'session_failed', taskId, sessionId: session.id, reason: String(err) });
    }
  }

  // True when every point assigned to this session is checked off in the plan.
  private sessionPointsDone(session: OrchestratorQueueSession): boolean {
    const plan = getLatestPlan(this.state.taskId);
    const steps = plan ? parsePlanSteps(plan.content) : [];
    return session.points.length > 0 &&
      session.points.every(pid => steps.some(s => s.id === pid && s.done));
  }

  // Mark a running session complete and advance the queue. The agent process is
  // intentionally kept alive after completion so the developer can reopen the
  // terminal, ask follow-up questions, or correct the result in the same context.
  private async completeSession(session: OrchestratorQueueSession): Promise<void> {
    if (session.status !== 'running') return;
    session.status = 'complete';
    if (session.runId) finishRun(session.runId, 'completed');
    broadcast({ type: 'session_complete', taskId: this.state.taskId, sessionId: session.id, runId: session.runId });
    await this.maybeAdvance();
  }

  // Primary completion path: the plan file changed. If a running session has all of
  // its assigned points checked off, it's done — regardless of any stop signal.
  async onPlanUpdated(): Promise<void> {
    if (this.state.status !== 'running') return;
    for (const session of this.state.sessions) {
      if (session.status === 'running' && this.sessionPointsDone(session)) {
        await this.completeSession(session);
      }
    }
  }

  // Secondary signal: the agent reported it stopped. If its points are all done we
  // complete it; otherwise it stopped early — ask the developer to review/continue.
  async onAgentStopped(runId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.runId === runId);
    if (!session) return;

    const { taskId } = this.state;
    if (session.status === 'ready_for_execution' || session.status === 'waiting_for_developer') {
      broadcast({
        type: 'session_idle',
        taskId,
        sessionId: session.id,
        runId,
        terminalSessionId: session.sessionId,
      });
      return;
    }

    if (session.status !== 'running' && session.status !== 'reviewing') return;

    if (session.queueMode === 'review_first' && session.status === 'reviewing') {
      session.status = 'ready_for_execution';
      this.state.status = 'paused';
      broadcast({
        type: 'session_ready_for_execution',
        taskId,
        sessionId: session.id,
        runId,
        terminalSessionId: session.sessionId,
        message: 'Ознакомление завершено. Можно обсудить детали или запустить выполнение.',
      });
      return;
    }

    if (this.sessionPointsDone(session)) {
      await this.completeSession(session);
    } else {
      session.status = 'waiting_for_developer';
      broadcast({
        type: 'session_waiting',
        taskId,
        sessionId: session.id,
        runId,
        terminalSessionId: session.sessionId,
        message: 'Agent stopped but not all assigned steps are checked off. Please review and continue.',
      });
    }
  }

  // Kill the live agent process for a session (if still running) without touching its
  // run record. Used to tear down agents once the queue moves past their step.
  private async killSessionProcess(session: OrchestratorQueueSession): Promise<void> {
    if (!session.runId) return;
    const live = getSession(session.runId);
    if (live) {
      try { await killAgent(live.sessionId, live.mode); } catch {}
      removeSession(session.runId);
    }
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
    await sendToAgent(session.sessionId, session.mode, prompt);
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

  private cleanupHook(): void {
    if (this.hookRepoPath) {
      try { cleanupClaudeStopHook(this.hookRepoPath); } catch {}
      this.hookRepoPath = null;
    }
  }

  private async finish(): Promise<void> {
    this.state.status = 'finished';
    this.cleanupHook();
    // Stop watcher keyed by task.key
    const task = getTask(this.state.taskId);
    if (task) stopWatchPlanFile(task.key);
    broadcast({ type: 'queue_finished', taskId: this.state.taskId });
    console.log(`[orchestrator] Queue finished for task ${this.state.taskId}`);
  }

  fail(reason: string): void {
    this.state.status = 'failed';
    void this.killAllAgents();
    this.cleanupHook();
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
