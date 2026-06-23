import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
import { Plan, PlanFrontmatter, PlanStep } from '../../models';

function parsePlanRow(row: Record<string, unknown>): Plan {
  return row as unknown as Plan;
}

export function getLatestPlan(task_id: string): Plan | null {
  const row = getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1').get(task_id) as Record<string, unknown> | undefined;
  return row ? parsePlanRow(row) : null;
}

export function getPlan(id: string): Plan | null {
  const row = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parsePlanRow(row) : null;
}

export function listPlans(task_id: string): Plan[] {
  const rows = getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC').all(task_id) as Record<string, unknown>[];
  return rows.map(parsePlanRow);
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

// Parse YAML frontmatter block
function parseFrontmatter(content: string): { meta: PlanFrontmatter; body: string } {
  if (!content.startsWith('---')) return { meta: {}, body: content };
  const rest = content.slice(3);
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) return { meta: {}, body: content };
  const yamlStr = rest.slice(0, endIdx);
  const body = rest.slice(endIdx + 4).replace(/^\n/, '');
  const meta: PlanFrontmatter = {};
  for (const line of yamlStr.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    if (key === 'plangent') meta.plangent = parseInt(trimmed, 10);
    else if (key === 'key') meta.key = trimmed;
    else if (key === 'title') meta.title = trimmed;
    else if (key === 'status') meta.status = trimmed as PlanFrontmatter['status'];
  }
  return { meta, body };
}

// Pattern: - [ ] (p1) text @parallel:groupA
// or:      - [x] text (no id yet)
const STEP_REGEX = /^(\s*-\s*)\[([ x])\]\s+(?:\(([^)]+)\)\s+)?(.+?)(\s+@parallel:(\S+))?$/i;

export function parsePlanSteps(content: string): PlanStep[] {
  const { body } = parseFrontmatter(content);
  const lines = body.split('\n');
  const steps: PlanStep[] = [];
  let index = 0;
  for (const line of lines) {
    const m = line.match(STEP_REGEX);
    if (!m) continue;
    const done = m[2].toLowerCase() === 'x';
    const stepId = m[3] || undefined;
    // m[4] is the text, m[5] is " @parallel:group", m[6] is just the group name
    // Strip @parallel tag from the display text
    const rawText = m[4].trim();
    const parallelGroup = m[6] || undefined;
    steps.push({ text: rawText, done, index: index++, id: stepId, parallelGroup });
  }
  return steps;
}

// Assign stable (pN) ids to checkbox lines that are missing them.
// Returns the new content and whether any changes were made.
export function assignMissingIds(content: string): { content: string; changed: boolean } {
  const lines = content.split('\n');
  let maxId = 0;
  for (const line of lines) {
    const m = line.match(/\(p(\d+)\)/i);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  }

  let changed = false;
  const result = lines.map(line => {
    // Match checkbox lines that do NOT already have (pN)
    const m = line.match(/^(\s*-\s*\[[ x]\]\s+)(?!\(p\d+\))/i);
    if (!m) return line;
    changed = true;
    maxId++;
    return line.replace(/^(\s*-\s*\[[ x]\]\s+)/i, `$1(p${maxId}) `);
  });
  return { content: result.join('\n'), changed };
}

export function markStepDone(content: string, stepIndex: number): string {
  const { body } = parseFrontmatter(content);
  const frontmatterLen = content.length - body.length;
  const frontmatter = content.slice(0, frontmatterLen);

  const lines = body.split('\n');
  let idx = 0;
  const updated = lines.map(line => {
    const m = line.match(STEP_REGEX);
    if (m) {
      if (idx === stepIndex && m[2] !== 'x') {
        idx++;
        return line.replace(/\[ \]/, '[x]');
      }
      idx++;
    }
    return line;
  });
  return frontmatter + updated.join('\n');
}

