import { DEFAULT_PLAN_REVIEW_INSTRUCTION } from './builtins';
export { DEFAULT_PLAN_REVIEW_INSTRUCTION } from './builtins';
import { readItemContent, writeItemContent, deleteItemContent } from './library-manager';
import { listLibraryItems, updateLibraryItem } from './index';
import { resolveInstructionText } from './section-settings';
import { planReviewLevelsMigrated, markPlanReviewLevelsMigrated } from '../../infrastructure/db/repositories/library/migration';

/**
 * The general checks of every plan review, written once in the settings: what to check and what to skip.
 * A project or group can write its own text of it; plan-review skills (plan-review-skill.ts) of older settings still come on top.
 * How cards, the overview and the coverage table are written is Plangent's protocol (PROTOCOL, tool descriptions).
 */

/** The nearest level wins: the project, its group, the global text, the built-in one. */
export function resolvePlanReviewInstruction(projectId: string): string {
  return resolveInstructionText('plan-review-instruction', projectId, DEFAULT_PLAN_REVIEW_INSTRUCTION);
}

/**
 * Project and group levels of the instruction were replaced by plan-review skills.
 * Once: each such text becomes a skill of the same level with the same content.
 */
export function migratePlanReviewInstructionLevels(): void {
  if (planReviewLevelsMigrated()) return;
  for (const item of listLibraryItems({ type: 'plan-review-instruction', scope: 'project' })) {
    const content = readItemContent(item);
    deleteItemContent(item);
    const moved = updateLibraryItem(item.id, { type: 'plan-review-skill', slug: 'plan_review_' + item.id.slice(0, 8), title: 'Требования к плану', description: '' });
    if (moved) writeItemContent(moved, content);
  }
  markPlanReviewLevelsMigrated();
}
