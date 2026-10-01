import fs from 'fs';
import { validateAnalysisLinks } from './analysis-context';
import path from 'path';
import { Task, Plan } from '../../models';
import { createPlan, updatePlan, assignMissingIds, parsePlanSteps, getLatestPlan, renumberSteps } from './plans';
import { broadcast } from '../shared/events';
import { remapQueuePoints } from './queue';
import { repairMojibake } from './encoding';

import { getTaskDirectory, getPlanFilePath, migratePlanFile, deleteTaskDirectory } from './task-files';
export { getPlanFilePath } from './task-files';
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

// A plan file as an agent left it: shell tools may have broken its encoding (see encoding.ts), and a
// read-modify-write can duplicate Plangent's hint line.
function cleanDiskPlan(content: string): string {
  let seenHint = false;
  return repairMojibake(content).split('\n').filter(line => {
    if (line.trim() !== PLAN_FILE_HINT) return true;
    if (seenHint) return false;
    seenHint = true;
    return true;
  }).join('\n');
}

// Write plan content to .plangent/<key>/plan.md, assigning missing ids first.
// Returns the (possibly modified) content written to disk.
export function materializePlanFile(task: Task, plan: Plan, repoPath: string): string {
  migratePlanFile(repoPath, task.key);
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
// We watch the task DIRECTORY (filtering by filename) rather than the file
// itself: agent file tools (and editors) often save atomically via a temp file +
// rename, which silently kills a file-level fs.watch after the first change — that
// caused only the first checked step to ever sync. A directory watch survives those
// atomic replacements and keeps catching every subsequent edit.
export function watchPlanFile(
  task: Task,
  planId: string,
  repoPath: string,
): void {
  const dir = getTaskDirectory(repoPath, task.key);
  const filePath = getPlanFilePath(repoPath, task.key);
  const fileName = 'plan.md';
  if (!fs.existsSync(dir)) return;
  stopWatchPlanFile(task.id);

  let debounce: NodeJS.Timeout | null = null;

  const watcher = fs.watch(dir, (_event, filename) => {
    // Some platforms report the changed filename; when they do, ignore other files.
    if (filename && filename !== fileName) return;
    if (isPlangentWrite(filePath)) return;

    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!fs.existsSync(filePath)) return;
      let content: string;
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch { return; }
      content = cleanDiskPlan(raw);

      // Assign missing ids if the agent added new steps
      const { content: withIds, changed: idsAdded } = assignMissingIds(content);
      const changed = idsAdded || content !== raw;
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
        steps: steps.map(s => ({ id: s.id, done: s.done, text: s.text, analysisLinks: s.analysisLinks, parallelGroup: s.parallelGroup })),
      });

      // Let the orchestrator react (auto-complete finished sessions).
      planSyncListener?.(task.id);
    }, 300);
  });

  watchers.set(task.id, watcher);
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

// Watch the task directory for the first creation of plan.md by an agent.
// On appearance: ingests into DB, assigns ids, broadcasts, then hands off to watchPlanFile.
export function watchPlanDirForCreate(task: Task, repoPath: string): void {
  const dir = getTaskDirectory(repoPath, task.key);
  fs.mkdirSync(dir, { recursive: true });
  ensureGitExclude(repoPath);

  const planFilePath = getPlanFilePath(repoPath, task.key);
  const fileName = 'plan.md';

  // Stop any previous dir watcher for this task
  const prev = dirWatchers.get(task.id);
  if (prev) { prev.close(); dirWatchers.delete(task.id); }

  let debounce: NodeJS.Timeout | null = null;

  const checkAndIngest = () => {
    if (!fs.existsSync(planFilePath)) return;
    let content: string;
    try { content = cleanDiskPlan(fs.readFileSync(planFilePath, 'utf-8')); } catch { return; }
    if (!content.trim()) return;

    const w = dirWatchers.get(task.id);
    if (w) { w.close(); dirWatchers.delete(task.id); }

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
      steps: steps.map(s => ({ id: s.id, done: s.done, text: s.text, analysisLinks: s.analysisLinks, parallelGroup: s.parallelGroup })),
    });
    planSyncListener?.(task.id);

    watchPlanFile(task, newPlan.id, repoPath);
  };

  const watcher = fs.watch(dir, (_event, filename) => {
    if (filename !== fileName) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(checkAndIngest, 400);
  });

  dirWatchers.set(task.id, watcher);
}

/**
 * A plan handed over by the planner (MCP submit_plan): checked, numbered, stored and written to
 * the plan file. Ids are Plangent's, so ones the agent invented are dropped and renumbered.
 */
export function submitPlan(task: Task, repoPath: string, content: string, renumber: boolean): { steps: string[]; removed: string[] } {
  validateAnalysisLinks(task.id, content);
  const previous = getLatestPlan(task.id);
  const known = new Set(parsePlanSteps(previous?.content ?? '').map(s => s.id?.toLowerCase()).filter(Boolean));
  let cleaned = content.replace(/\r\n/g, '\n').split('\n')
    .map(line => line.replace(/^(\s*-\s*\[[ x]\]\s+)\((p\d+)\)\s+/i, (whole, head: string, id: string) => (known.has(id.toLowerCase()) ? whole : head)))
    .join('\n');
  if (!parsePlanSteps(cleaned).length) throw new Error('The plan has no steps. A step is a line "- [ ] step text".');
  const submitted = new Set(parsePlanSteps(cleaned).map(s => s.id?.toLowerCase()));
  const removed = [...known].filter(id => !submitted.has(id)) as string[];
  // With nothing executing yet, ids follow the order of the steps; otherwise they must stay put.
  let idMap: Record<string, string> = {};
  if (renumber) ({ content: cleaned, idMap } = renumberSteps(cleaned));
  remapQueuePoints(task.id, idMap);

  const dirWatcher = dirWatchers.get(task.id);
  if (dirWatcher) { dirWatcher.close(); dirWatchers.delete(task.id); }
  ensureGitExclude(repoPath);
  const plan = previous ? updatePlan(previous.id, cleaned)! : createPlan({ task_id: task.id, content: cleaned });
  const written = materializePlanFile(task, plan, repoPath);
  watchPlanFile(task, plan.id, repoPath);

  const steps = parsePlanSteps(written);
  broadcast({ type: 'plan_updated', taskId: task.id, content: written, idMap,
    steps: steps.map(s => ({ id: s.id, done: s.done, text: s.text, analysisLinks: s.analysisLinks, parallelGroup: s.parallelGroup })) });
  return { steps: steps.map(s => `(${s.id}) ${s.text}`), removed };
}

export function stopWatchPlanFile(taskId: string): void {
  const w = watchers.get(taskId);
  if (w) { w.close(); watchers.delete(taskId); }
}

export function deletePlanFile(task: Task, repoPath: string): void {
  stopWatchPlanFile(task.id);
  migratePlanFile(repoPath, task.key);
  const watcher = dirWatchers.get(task.id);
  if (watcher) { watcher.close(); dirWatchers.delete(task.id); }
  deleteTaskDirectory(task, repoPath);
}
