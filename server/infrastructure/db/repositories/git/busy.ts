import { getDb } from '../../schema';

export const busyRecords = {
  hasFinishTable: () => getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='finish_runs'").get(),
  listActiveFinishes: (exceptId: string) => getDb().prepare("SELECT project_id,workspace_id FROM finish_runs WHERE status NOT IN ('complete','cancelled') AND id<>?").all(exceptId),
};
