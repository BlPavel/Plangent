import { transaction } from '../../../infrastructure/db/repositories/preparation/transaction';
import * as queries from '../../../infrastructure/db/repositories/preparation/materials/stages';
import { createHash } from 'node:crypto';
import { listAnalysisSections, listAnalysisFiles, assertAnalysisEditable } from '../analysis';
import { getLatestPlan } from '../plans';
import { broadcast } from '../../shared';
import { getLatestMaterial, MaterialConflict } from './index';

export const preparationStages = ['analysis', 'architecture', 'qa', 'plan'] as const;
export type PreparationStage = typeof preparationStages[number];
interface Mark { stage: PreparationStage; status: 'ready' | 'skipped'; material_version: string; marked_at: string }
function source(taskId: string, stage: PreparationStage) {
  if (stage === 'analysis') return listAnalysisSections(taskId).map(section => ({ ...section,
    files: listAnalysisFiles(section.id) }));
  return stage === 'plan' ? getLatestPlan(taskId) : getLatestMaterial(taskId, stage);
}
function revision(value: ReturnType<typeof source>): string {
  // Includes file bytes and plan edits in place, which do not increment plan.version.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function getPreparationStages(taskId: string): import('@contracts').StageSummary[] {
  const marks = queries.marksSelectPreparationMarks(taskId) as Mark[];
  return preparationStages.map(stage => {
    const value = source(taskId, stage);
    const present = Array.isArray(value) ? value.length > 0 : value !== null;
    const mark = marks.find(item => item.stage === stage);
    return { stage, status: mark?.status ?? (present ? 'draft' : 'not_started'),
      material_version: revision(value), marked_version: mark?.material_version ?? null,
      marked_at: mark?.marked_at ?? null,
      changed_since_mark: !!mark && mark.material_version !== revision(value) };
  });
}
/** Called by explicit developer HTTP actions only; intentionally has no MCP tool. */
export function markPreparationStage(taskId: string, stage: PreparationStage, status: 'ready' | 'skipped') {
  if (!preparationStages.includes(stage) || !['ready', 'skipped'].includes(status)) throw new Error('Invalid stage action');
  try { assertAnalysisEditable(taskId); } catch (error) { throw new MaterialConflict((error as Error).message); }
  transaction(() => {
    const summary = getPreparationStages(taskId);
    const current = summary.find(item => item.stage === stage)!;
    const value = source(taskId, stage);
    if (status === 'ready' && (Array.isArray(value) ? !value.length : value === null))
      throw new Error('Save material before marking it ready');
    const write = queries.writeInsertPreparationMarks;
    write(taskId, stage, status, current.material_version);
    if (status === 'ready') for (const item of summary.slice(0, preparationStages.indexOf(stage))) {
      if (item.status !== 'ready' && item.status !== 'skipped') write(taskId, item.stage, 'skipped', item.material_version);
    }
  });
  const stages = getPreparationStages(taskId);
  broadcast({ type: 'stages_updated', taskId, stages });
  return stages;
}
/** Only explicitly accepted sources may become context for downstream operations. */
export function getReadyMaterials(taskId: string) {
  const ready = new Set(getPreparationStages(taskId).filter(item => item.status === 'ready').map(item => item.stage));
  return {
    analysis: ready.has('analysis') ? listAnalysisSections(taskId).map(section => ({ ...section, files: listAnalysisFiles(section.id) })) : [],
    architecture: ready.has('architecture') ? getLatestMaterial(taskId, 'architecture') : null,
    qa: ready.has('qa') ? getLatestMaterial(taskId, 'qa') : null,
    plan: ready.has('plan') ? getLatestPlan(taskId) : null,
  };
}
