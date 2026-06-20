import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { Plan, PlanStep } from '../models/types';

function parsePlan(row: Record<string, unknown>): Plan {
  return row as unknown as Plan;
}

export function getLatestPlan(task_id: string): Plan | null {
  const row = getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1').get(task_id) as Record<string, unknown> | undefined;
  return row ? parsePlan(row) : null;
}

export function getPlan(id: string): Plan | null {
  const row = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parsePlan(row) : null;
}

export function listPlans(task_id: string): Plan[] {
  const rows = getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC').all(task_id) as Record<string, unknown>[];
  return rows.map(parsePlan);
}

export function createPlan(data: { task_id: string; content: string }): Plan {
  const id = uuidv4();
  const db = getDb();
  const latest = getLatestPlan(data.task_id);
  const version = latest ? latest.version + 1 : 1;
  db.prepare(`
    INSERT INTO plans (id, task_id, content, version) VALUES (?, ?, ?, ?)
  `).run(id, data.task_id, data.content, version);
  return getPlan(id)!;
}

export function updatePlan(id: string, content: string): Plan | null {
  const db = getDb();
  db.prepare(`
    UPDATE plans SET content=?, updated_at=datetime('now') WHERE id=?
  `).run(content, id);
  return getPlan(id);
}

export function parsePlanSteps(content: string): PlanStep[] {
  const lines = content.split('\n');
  const steps: PlanStep[] = [];
  let index = 0;
  for (const line of lines) {
    const doneMatch = line.match(/^\s*-\s*\[x\]\s+(.+)/i);
    const todoMatch = line.match(/^\s*-\s*\[ \]\s+(.+)/);
    if (doneMatch) {
      steps.push({ text: doneMatch[1].trim(), done: true, index: index++ });
    } else if (todoMatch) {
      steps.push({ text: todoMatch[1].trim(), done: false, index: index++ });
    }
  }
  return steps;
}

export function markStepDone(content: string, stepIndex: number): string {
  const lines = content.split('\n');
  let idx = 0;
  return lines.map(line => {
    const todoMatch = line.match(/^(\s*-\s*)\[ \](\s+.+)/);
    if (todoMatch) {
      if (idx === stepIndex) {
        idx++;
        return `${todoMatch[1]}[x]${todoMatch[2]}`;
      }
      idx++;
    } else if (line.match(/^\s*-\s*\[x\]/i)) {
      idx++;
    }
    return line;
  }).join('\n');
}
