import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';
import { updateSession } from '../agent-sessions/sessions';
import { getTask } from '../tasks';
import type { ExecutionPolicy, OrchestratorQueueSession, QueueStage, TaskQueue } from '../../models';

export function initQueues(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS task_queues (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Agents do not survive a restart: a queue that was executing is stopped, its live
  // sessions become `stopped` and run again when the developer relaunches the queue.
  for (const queue of allQueues()) {
    if (queue.status !== 'running' && queue.status !== 'paused') continue;
    queue.status = 'stopped';
    queue.reason = 'Приложение перезапущено';
    for (const s of queue.stages.flatMap(st => st.sessions)) {
      if (!isActive(s)) continue;
      s.status = 'stopped';
      // initSessions() flagged their chats "waiting — continue the session"; the queue will start them anew instead.
      for (const id of [s.sessionId, s.reviewSessionId]) {
        if (id && getDb().prepare('SELECT 1 FROM agent_sessions WHERE id=?').get(id)) updateSession(id, { status: 'complete', reason: 'Очередь остановлена: приложение перезапущено' });
      }
    }
    saveQueue(queue, false);
  }
}

export const isActive = (s: OrchestratorQueueSession) => !['queued', 'complete', 'failed', 'stopped'].includes(s.status);
export const isFrozen = (q: TaskQueue) => q.status === 'running' || q.status === 'paused';

function allQueues(): TaskQueue[] {
  return (getDb().prepare('SELECT data FROM task_queues').all() as { data: string }[]).map(r => JSON.parse(r.data));
}

export function getQueue(taskId: string, projectId: string): TaskQueue {
  const row = getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(taskId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : { taskId, projectId, status: 'idle', stages: [], stageIndex: 0, pauseRequested: false, updatedAt: new Date().toISOString() };
}

export function saveQueue(queue: TaskQueue, notify = true): TaskQueue {
  queue.updatedAt = new Date().toISOString();
  getDb().prepare(`INSERT INTO task_queues (task_id, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`).run(queue.taskId, JSON.stringify(queue));
  if (notify) broadcast({ type: 'queue_updated', taskId: queue.taskId, queue });
  return queue;
}

/**
 * Move the stages whose every session is done into the history, so the queue holds only
 * what is still to run and a new run numbers its stages from one again.
 */
export function archiveFinished(queue: TaskQueue): void {
  const done = queue.stages.filter(st => st.sessions.every(s => s.status === 'complete'));
  if (!done.length) return;
  queue.stages = queue.stages.filter(st => !done.includes(st));
  queue.history = [{ id: uuidv4(), finishedAt: new Date().toISOString(), stages: done }, ...(queue.history ?? [])].slice(0, 20);
}

export interface BlockedQueue { projectId: string; taskId: string; taskKey: string; reason: string }

/**
 * Executing queues that cannot go on without the developer: paused, a step asking a question
 * or waiting for the go-ahead, or an agent's permission request (visible only on its chat).
 */
export function blockedQueues(): BlockedQueue[] {
  const result: BlockedQueue[] = [];
  for (const queue of allQueues()) {
    if (!isFrozen(queue)) continue;
    const task = getTask(queue.taskId);
    if (!task) continue;
    const add = (reason: string) => result.push({ projectId: queue.projectId, taskId: queue.taskId, taskKey: task.key, reason });
    if (queue.status === 'paused') { add('очередь на паузе'); continue; }
    const live = queue.stages.flatMap(st => st.sessions).filter(isActive);
    const chatWaiting = (id?: string) => {
      if (!id) return false;
      const row = getDb().prepare('SELECT status FROM agent_sessions WHERE id=?').get(id) as { status: string } | undefined;
      return row?.status === 'waiting';
    };
    const asking = live.find(s => s.status === 'waiting_for_developer' || s.status === 'ready_for_execution' || chatWaiting(s.sessionId) || chatWaiting(s.reviewSessionId));
    if (asking) add(asking.status === 'ready_for_execution' ? 'шаг ждёт команды на выполнение' : 'агенту нужен ваш ответ');
  }
  return result;
}

// The planner renumbered the plan's steps (only while the queue is not executing): the queue follows.
export function remapQueuePoints(taskId: string, idMap: Record<string, string>): void {
  const row = getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(taskId) as { data: string } | undefined;
  if (!row || !Object.keys(idMap).length) return;
  const queue: TaskQueue = JSON.parse(row.data);
  for (const s of queue.stages.flatMap(st => st.sessions)) s.points = s.points.map(p => idMap[p.toLowerCase()] ?? p);
  saveQueue(queue);
}

export interface StageInput {
  id?: string;
  pauseAfter?: boolean;
  sessions: (Partial<OrchestratorQueueSession> & { points: string[]; agentId: string })[];
}

const POLICIES: ExecutionPolicy[] = ['allow-all', 'allow-edits', 'ask'];

// Replace the queue layout from the editor. Only configuration comes from the client:
// the status and run bookkeeping of sessions it already knows are kept from the stored queue.
export function replaceStages(queue: TaskQueue, input: StageInput[]): TaskQueue {
  const known = new Map(queue.stages.flatMap(st => st.sessions).map(s => [s.id, s]));
  const stages: QueueStage[] = [];
  for (const st of input) {
    const sessions = (st.sessions ?? []).filter(s => Array.isArray(s.points) && s.points.length && s.agentId).map(s => {
      const prev = s.id ? known.get(s.id) : undefined;
      const session: OrchestratorQueueSession = {
        ...(prev ?? { id: uuidv4(), status: 'queued' as const }),
        points: s.points.map(String),
        agentId: s.agentId,
        queueMode: s.queueMode === 'review_first' ? 'review_first' : 'execute',
        permissionPolicy: POLICIES.includes(s.permissionPolicy as ExecutionPolicy) ? s.permissionPolicy as ExecutionPolicy : 'allow-all',
        model: s.model || undefined,
        reasoningEffort: s.reasoningEffort || undefined,
        reviewerId: s.reviewerId || undefined,
        maxReviewRounds: Math.max(1, Math.min(10, s.maxReviewRounds ?? 2)),
      };
      return session;
    });
    if (sessions.length) stages.push({ id: st.id || uuidv4(), pauseAfter: !!st.pauseAfter, sessions });
  }
  queue.stages = stages;
  if (!stages.length) { queue.status = 'idle'; queue.reason = undefined; }
  return queue;
}
