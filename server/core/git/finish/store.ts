import { updateFinish as saveFinish } from '../../../infrastructure/db/repositories/git/finish';
import type { FinishRun } from '../../../models/finish';
import { broadcast } from '../../shared';
export { getFinish, activeFinish, taskFinishState, insertFinish, cancelOrphanFinishes } from '../../../infrastructure/db/repositories/git/finish';
export function updateFinish(id: string, patch: Partial<FinishRun>): FinishRun {
  const run = saveFinish(id, patch);
  broadcast({ type: 'finish:changed', projectId: run.project_id, run });
  broadcast({ type: 'code:changed', projectId: run.project_id });
  return run;
}
