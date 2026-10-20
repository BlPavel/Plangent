import { getDb } from '../../infrastructure/db/schema';
import type { FinishRun } from '../../models/finish';
import { CodeError } from '../code/files';
import { broadcast } from '../shared/events';
function parse(row: unknown): FinishRun {
  const data = row as Omit<FinishRun, 'options' | 'commits' | 'pushed' | 'mr_draft'> & { options: string; commits: string; pushed: number; mr_draft: string | null };
  return { ...data, options: JSON.parse(data.options), commits: JSON.parse(data.commits), pushed: !!data.pushed, mr_draft: data.mr_draft ? JSON.parse(data.mr_draft) : null };
}
export function getFinish(id: string): FinishRun {
  const row = getDb().prepare('SELECT * FROM finish_runs WHERE id=?').get(id);
  if (!row) throw new CodeError('Finish workflow not found', 404);
  return parse(row);
}
export function activeFinish(projectId: string): FinishRun | null {
  const row = getDb().prepare("SELECT * FROM finish_runs WHERE project_id=? AND status NOT IN ('complete','cancelled') ORDER BY created_at DESC LIMIT 1").get(projectId);
  return row ? parse(row) : null;
}
export function taskFinishState(taskId: string) {
  const row = getDb().prepare('SELECT * FROM finish_runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
  if (!row) return null;
  const run = parse(row);
  return { id: run.id, project_id: run.project_id, stage: run.stage, status: run.status, error: run.error };
}
export function insertFinish(run: FinishRun): FinishRun {
  getDb().prepare('INSERT INTO finish_runs(id,project_id,task_id,scenario,options,base_head,branch,snapshot_tree,stage,status,commits,session_id,note,error,output,pushed,mr_url,mr_draft) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(run.id, run.project_id, run.task_id, run.scenario, JSON.stringify(run.options), run.base_head, run.branch, run.snapshot_tree, run.stage, run.status, JSON.stringify(run.commits), run.session_id, run.note, run.error, run.output, +run.pushed, run.mr_url, run.mr_draft ? JSON.stringify(run.mr_draft) : null);
  return getFinish(run.id);
}
export function updateFinish(id: string, patch: Partial<FinishRun>): FinishRun {
  const columns = ['stage','status','commits','session_id','note','error','output','pushed','mr_url','mr_draft','branch','snapshot_tree'];
  const entries = Object.entries(patch).filter(([key]) => columns.includes(key));
  if (entries.length) getDb().prepare('UPDATE finish_runs SET ' + entries.map(([key]) => key + '=?').join(',') + ",updated_at=datetime('now') WHERE id=?")
    .run(...entries.map(([key,value]) => ['commits', 'mr_draft'].includes(key) ? JSON.stringify(value) : key === 'pushed' ? +!!value : value), id);
  const run = getFinish(id);
  broadcast({ type: 'finish:changed', projectId: run.project_id, run });
  broadcast({ type: 'code:changed', projectId: run.project_id });
  return run;
}
