import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { Run } from '../models/types';

function parse(row: Record<string, unknown>): Run {
  return {
    ...(row as Omit<Run, 'completed_steps'>),
    completed_steps: JSON.parse(row.completed_steps as string || '[]'),
  };
}

export function listRuns(task_id: string): Run[] {
  return (getDb().prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(task_id) as Record<string, unknown>[]).map(parse);
}

export function getRun(id: string): Run | null {
  const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export function createRun(data: { task_id: string; plan_id?: string; agent_id?: string; agent_name: string }): Run {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO runs (id, task_id, plan_id, agent_id, agent_name, completed_steps)
    VALUES (?, ?, ?, ?, ?, '[]')
  `).run(id, data.task_id, data.plan_id ?? null, data.agent_id ?? null, data.agent_name);
  return getRun(id)!;
}

export function updateRun(id: string, data: Partial<Pick<Run, 'status' | 'completed_steps' | 'notes' | 'finished_at'>>): Run | null {
  const current = getRun(id);
  if (!current) return null;
  const u = { ...current, ...data };
  getDb().prepare(`
    UPDATE runs SET status=?, completed_steps=?, notes=?, finished_at=? WHERE id=?
  `).run(u.status, JSON.stringify(u.completed_steps), u.notes ?? null, u.finished_at ?? null, id);
  return getRun(id);
}

export function addCompletedStep(run_id: string, step: string): Run | null {
  const run = getRun(run_id);
  if (!run) return null;
  return updateRun(run_id, { completed_steps: [...run.completed_steps, step] });
}

export function finishRun(run_id: string, status: Run['status'], notes?: string): Run | null {
  return updateRun(run_id, { status, notes, finished_at: new Date().toISOString() });
}
