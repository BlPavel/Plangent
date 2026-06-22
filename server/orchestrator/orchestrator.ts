import { v4 as uuidv4 } from 'uuid';
import {
  OrchestratorQueueSession,
  OrchestratorState,
  OrchestratorStatus,
} from '../models/types';
import { getTask } from '../storage/tasks';
import { getProject } from '../storage/projects';
import { getAgent } from '../storage/agents';
import { getLatestPlan, createPlan, parsePlanSteps } from '../storage/plans';
import { createRun, finishRun } from '../storage/runs';
import { updateTask } from '../storage/tasks';
import { launchAgent, buildPrompt, deployClaudeStopHook, cleanupClaudeStopHook } from '../adapters/generic';
import { materializePlanFile, watchPlanFile, stopWatchPlanFile } from '../services/plan-file';
import { registerSession, removeSession } from '../services/session-registry';
import { broadcast } from '../services/events';
import path from 'path';

export interface QueueSessionInput {
  points: string[];
  agentId: string;
  parallelGroup: string | null;
}

// Group sequential sessions into "steps" (parallel group = run concurrently)
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
      while (i < sessions.length && sessions[i].parallelGroup === current.parallelGroup) {
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

export class Orchestrator {
  readonly state: OrchestratorState;
  private steps: OrchestratorQueueSession[][];
  private stepIndex = 0;
  // Track hook cleanup paths keyed by runId
  private hookPaths = new Map<string, string>();

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
      this.finish();
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
    const prompt = buildPrompt({
      projectName: project.name,
      taskKey: task.key,
      taskTitle: task.title ?? undefined,
      taskDescription: task.description ?? undefined,
      planFilePath: planRelPath,
      points: session.points,
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

    // Deploy Stop hook for Claude Code
    if (agent.id === 'agent-claude') {
      try {
        deployClaudeStopHook(project.repo_path, CALLBACK_URL, projectId, taskId, run.id);
        this.hookPaths.set(run.id, project.repo_path);
      } catch (e) {
        console.warn('[orchestrator] Could not deploy stop hook:', e);
      }
    }

    try {
      const result = await launchAgent(agent, project.repo_path, sessionId, extraEnv, prompt);
      session.runId = run.id;
      session.sessionId = sessionId;
      session.mode = result.mode;
      session.status = 'running';

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
        if (session.status === 'running') {
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

  // Called by the agent-stopped endpoint
  async onAgentStopped(runId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.runId === runId);
    if (!session || session.status !== 'running') return;

    const { taskId, projectId } = this.state;
    const task = getTask(taskId);
    const project = getProject(projectId);
    if (!task || !project) return;

    // Cleanup hook
    if (this.hookPaths.has(runId)) {
      try { cleanupClaudeStopHook(project.repo_path); } catch {}
      this.hookPaths.delete(runId);
    }

    // Re-read plan to check point completion
    const plan = getLatestPlan(taskId);
    const steps = plan ? parsePlanSteps(plan.content) : [];
    const allDone = session.points.every(pid => steps.some(s => s.id === pid && s.done));

    if (allDone) {
      session.status = 'complete';
      finishRun(runId, 'completed');
      removeSession(runId);
      broadcast({ type: 'session_complete', taskId, sessionId: session.id, runId });

      // Advance if all sessions in current step are done
      const step = this.steps[this.stepIndex];
      if (step.every(s => s.status === 'complete')) {
        this.stepIndex++;
        await this.executeStep();
      }
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

  // Manual advance by developer (when session is waiting_for_developer)
  async manualAdvance(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId);
    if (!session || session.status !== 'waiting_for_developer') return;
    session.status = 'complete';
    if (session.runId) {
      finishRun(session.runId, 'completed');
      removeSession(session.runId);
    }
    broadcast({ type: 'session_complete', taskId: this.state.taskId, sessionId: session.id, runId: session.runId });

    const step = this.steps[this.stepIndex];
    if (step.every(s => s.status === 'complete')) {
      this.stepIndex++;
      await this.executeStep();
    }
  }

  private finish(): void {
    this.state.status = 'finished';
    // Stop watcher keyed by task.key
    const task = getTask(this.state.taskId);
    if (task) stopWatchPlanFile(task.key);
    broadcast({ type: 'queue_finished', taskId: this.state.taskId });
    console.log(`[orchestrator] Queue finished for task ${this.state.taskId}`);
  }

  fail(reason: string): void {
    this.state.status = 'failed';
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
