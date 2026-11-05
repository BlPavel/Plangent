import { getDb } from '../../schema';
export function saveTaskBaseCommit(taskId: string, head: string, reset: boolean) {
  getDb().prepare(reset ? 'UPDATE tasks SET base_commit=? WHERE id=?' : "UPDATE tasks SET base_commit=? WHERE id=? AND (base_commit IS NULL OR base_commit='')").run(head, taskId);
}
