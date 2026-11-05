import { getDb } from '../../schema';

export const mergeRequestsRecords = {
  saveTaskLink: (link: string, branch: string, taskId: string) => getDb().prepare("UPDATE tasks SET mr_link=?,branch_name=COALESCE(NULLIF(branch_name,''),?) WHERE id=?").run(link, branch, taskId),
  hasCreationIntent: (id: string) => getDb().prepare('SELECT 1 FROM mr_creation_intents WHERE id=?').get(id),
  insertCreationIntent: (id: string) => getDb().prepare('INSERT INTO mr_creation_intents(id) VALUES (?)').run(id),
  deleteCreationIntent: (id: string) => getDb().prepare('DELETE FROM mr_creation_intents WHERE id=?').run(id),
  completeTask: (taskId: string) => getDb().prepare("UPDATE tasks SET status='done' WHERE id=?").run(taskId),
};
