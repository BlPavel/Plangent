import { getDb, inTransaction } from '../../schema';

/** Atomically keep a task and its existing workspace bound to the checked-out branch. */
export function saveWorkBranch(taskId: string, workspaceId: string, branch: string): void {
  inTransaction(() => {
    const db = getDb();
    const workspace = db.prepare("UPDATE workspaces SET branch=? WHERE id=? AND task_id=? AND status='ready'")
      .run(branch, workspaceId, taskId);
    if (workspace.changes !== 1) throw new Error('Workspace changed during branch switch');
    const task = db.prepare('UPDATE tasks SET branch_name=? WHERE id=?').run(branch, taskId);
    if (task.changes !== 1) throw new Error('Task changed during branch switch');
  });
}
