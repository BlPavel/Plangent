import type { FinishRun, FinishStage, FinishStatus } from '../../models/finish';
export type FinishEvent = 'branch_ready' | 'commits_ready' | 'revise' | 'accept' | 'push_done' | 'mr_done' | 'cancel';
export function transition(run: Pick<FinishRun, 'stage' | 'status' | 'scenario'>, event: FinishEvent): { stage: FinishStage; status: FinishStatus } {
  if (['complete', 'cancelled'].includes(run.status)) throw new Error('Workflow already closed');
  if (event === 'cancel' && (run.stage !== 'push' || run.status === 'error')) return { stage: run.stage, status: 'cancelled' };
  if (event === 'branch_ready' && run.stage === 'branch') return { stage: 'commits', status: 'running' };
  if (event === 'commits_ready' && run.stage === 'commits') return { stage: 'confirmation', status: 'waiting' };
  if (event === 'revise' && run.stage === 'confirmation') return { stage: 'commits', status: 'running' };
  if (event === 'accept' && run.stage === 'confirmation' && run.status === 'waiting') return run.scenario === 'commits'
    ? { stage: 'done', status: 'complete' } : { stage: 'push', status: 'running' };
  if (event === 'push_done' && run.stage === 'push') return run.scenario === 'full' ? { stage: 'mr', status: 'running' } : { stage: 'done', status: 'complete' };
  if (event === 'mr_done' && run.stage === 'mr') return { stage: 'done', status: 'complete' };
  throw new Error('Invalid finish transition: ' + run.stage + '/' + run.status + ' → ' + event);
}
