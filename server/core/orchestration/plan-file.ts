import fs from 'fs';
import path from 'path';
import { Task, Plan } from '../../models';
import { createPlan, updatePlan, assignMissingIds, parsePlanSteps } from './plans';
import { broadcast } from '../shared/events';

const PLANGENT_DIR = '.plangent';
const PLAN_FILE_HINT = '<!-- Plangent: строки "- [ ] ..." - это шаги очереди. Не удаляйте скобки [ ]. -->';

const watchers = new Map<string, fs.FSWatcher>();
// Track writes made by Plangent to avoid echo on fs.watch
const plangentWriteTimestamps = new Map<string, number>();

// Notified after a plan file is synced from disk to the DB. The orchestrator
// subscribes so it can complete a running session as soon as all its assigned
// points are checked off — independent of any agent-specific stop signal.
type PlanSyncListener = (taskId: string) => void;
let planSyncListener: PlanSyncListener | null = null;
export function setPlanSyncListener(fn: PlanSyncListener): void {
  planSyncListener = fn;
}

export function getPlanFilePath(repoPath: string, taskKey: string): string {
  return path.join(repoPath, PLANGENT_DIR, `${taskKey}.plan.md`);
}

function ensurePlanFileHint(content: string): string {
  if (content.includes(PLAN_FILE_HINT)) return content;

  if (!content.startsWith('---')) return `${PLAN_FILE_HINT}\n${content}`;

  const rest = content.slice(3);
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) return `${PLAN_FILE_HINT}\n${content}`;

  const frontmatterEnd = 3 + endIdx + 4;
  const body = content.slice(frontmatterEnd).replace(/^\n/, '');
  return `${content.slice(0, frontmatterEnd)}\n${PLAN_FILE_HINT}\n${body}`;
}

// Write plan content to .plangent/<key>.plan.md, assigning missing ids first.
// Returns the (possibly modified) content written to disk.
export function materializePlanFile(task: Task, plan: Plan, repoPath: string): string {
  const filePath = getPlanFilePath(repoPath, task.key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const { content: withIds, changed } = assignMissingIds(plan.content);
  const finalContent = ensurePlanFileHint(changed ? withIds : plan.content);

  if (changed || finalContent !== plan.content) {
    updatePlan(plan.id, finalContent);
  }

  markPlangentWrite(filePath);
  fs.writeFileSync(filePath, finalContent, 'utf-8');
  return finalContent;
}

function markPlangentWrite(filePath: string): void {
  plangentWriteTimestamps.set(filePath, Date.now());
}

function isPlangentWrite(filePath: string): boolean {
  const ts = plangentWriteTimestamps.get(filePath);
  if (!ts) return false;
  return Date.now() - ts < 600;  // 600ms grace window
}

// Watch the plan file for changes and sync them back to DB.
//
// We watch the .plangent/ DIRECTORY (filtering by filename) rather than the file
// itself: agent file tools (and editors) often save atomically via a temp file +
// rename, which silently kills a file-level fs.watch after the first change — that
// caused only the first checked step to ever sync. A directory watch survives those
// atomic replacements and keeps catching every subsequent edit.
export function watchPlanFile(
  task: Task,
  planId: string,
  repoPath: string,
): void {
  const dir = path.join(repoPath, PLANGENT_DIR);
  const filePath = getPlanFilePath(repoPath, task.key);
  const fileName = `${task.key}.plan.md`;
  if (!fs.existsSync(dir)) return;
  stopWatchPlanFile(task.key);

  let debounce: NodeJS.Timeout | null = null;

  const watcher = fs.watch(dir, (_event, filename) => {
    // Some platforms report the changed filename; when they do, ignore other files.
    if (filename && filename !== fileName) return;
    if (isPlangentWrite(filePath)) return;

    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!fs.existsSync(filePath)) return;
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch { return; }

      // Assign missing ids if the agent added new steps
      const { content: withIds, changed } = assignMissingIds(content);
      if (changed) {
        markPlangentWrite(filePath);
        try {
          fs.writeFileSync(filePath, withIds, 'utf-8');
        } catch { return; }
        content = withIds;
      }

      // Sync to DB
      updatePlan(planId, content);

      // Emit live point-update events
      const steps = parsePlanSteps(content);
      broadcast({
        type: 'plan_updated',
        taskId: task.id,
        content,
        steps: steps.map(s => ({ id: s.id, done: s.done, text: s.text, parallelGroup: s.parallelGroup })),
      });

      // Let the orchestrator react (auto-complete finished sessions).
      planSyncListener?.(task.id);
    }, 300);
  });

  watchers.set(task.key, watcher);
}

// Add .plangent/ to .git/info/exclude so plan files never appear in git status.
function ensureGitExclude(repoPath: string): void {
  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) return;
  const excludePath = path.join(gitDir, 'info', 'exclude');
  const pattern = '.plangent/';
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : '';
    if (!existing.includes(pattern)) {
      fs.appendFileSync(excludePath, `\n${pattern}\n`, 'utf-8');
    }
  } catch { /* ignore */ }
}

const dirWatchers = new Map<string, fs.FSWatcher>();

// Watch .plangent/ directory for the first creation of <key>.plan.md by an agent.
// On appearance: ingests into DB, assigns ids, broadcasts, then hands off to watchPlanFile.
export function watchPlanDirForCreate(task: Task, repoPath: string): void {
  const dir = path.join(repoPath, PLANGENT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  ensureGitExclude(repoPath);

  const planFilePath = getPlanFilePath(repoPath, task.key);
  const fileName = `${task.key}.plan.md`;

  // Stop any previous dir watcher for this task
  const prev = dirWatchers.get(task.key);
  if (prev) { prev.close(); dirWatchers.delete(task.key); }

  let debounce: NodeJS.Timeout | null = null;

  const checkAndIngest = () => {
    if (!fs.existsSync(planFilePath)) return;
    let content: string;
    try { content = fs.readFileSync(planFilePath, 'utf-8'); } catch { return; }
    if (!content.trim()) return;

    const w = dirWatchers.get(task.key);
    if (w) { w.close(); dirWatchers.delete(task.key); }

    const { content: withIds } = assignMissingIds(content);
    const withHint = ensurePlanFileHint(withIds);
    const newPlan = createPlan({ task_id: task.id, content: withHint });

    markPlangentWrite(planFilePath);
    try { fs.writeFileSync(planFilePath, withHint, 'utf-8'); } catch { /* ignore */ }

    const steps = parsePlanSteps(withHint);
    broadcast({
      type: 'plan_updated',
      taskId: task.id,
      content: withHint,
      steps: steps.map(s => ({ id: s.id, done: s.done, text: s.text, parallelGroup: s.parallelGroup })),
    });
    planSyncListener?.(task.id);

    watchPlanFile(task, newPlan.id, repoPath);
  };

  const watcher = fs.watch(dir, (_event, filename) => {
    if (filename !== fileName) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(checkAndIngest, 400);
  });

  dirWatchers.set(task.key, watcher);
}

export function stopWatchPlanFile(taskKey: string): void {
  const w = watchers.get(taskKey);
  if (w) { w.close(); watchers.delete(taskKey); }
}

export function deletePlanFile(task: Task, repoPath: string): void {
  stopWatchPlanFile(task.key);
  const filePath = getPlanFilePath(repoPath, task.key);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}
