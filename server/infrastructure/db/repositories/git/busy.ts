import { getDb } from '../../schema';
import { ACTIVE_FINISH } from './finish';

export const busyRecords = {
  hasFinishTable: () => getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='finish_runs'").get(),
  listActiveFinishes: (exceptId: string) => getDb().prepare(`SELECT project_id,workspace_id FROM finish_runs WHERE ${ACTIVE_FINISH} AND id<>?`).all(exceptId),
};
