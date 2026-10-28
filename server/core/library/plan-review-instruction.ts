import { readItemContent, writeItemContent, deleteItemContent } from './library-manager';
import { listLibraryItems, updateLibraryItem } from './index';
import { getDb } from '../../infrastructure/db/schema';

/**
 * The general checks of every plan review, written once in the settings: what to check and what to skip.
 * A project's or group's own requirements are plan-review skills (plan-review-skill.ts) that come on top.
 * How cards, the overview and the coverage table are written is Plangent's protocol (PROTOCOL, tool descriptions).
 */
export const DEFAULT_PLAN_REVIEW_INSTRUCTION = `# Plan review
1. Check that the steps do not contradict each other or the analysis materials.
2. Check that the order is executable: everything step N+1 needs exists after step N, and no step depends on a later one. Parallel steps must not change the same files.
3. Match every requirement of the analysis to the steps. Find requirements nobody covers and work that does not follow from the task materials.
4. Check that every step can be verified: its description must make clear when it is done.
Back every remark with concrete steps and materials. Suggest a fix when it is clear.`;

/** The global text; without one the built-in text applies. */
export function resolvePlanReviewInstruction(): string {
  const item = listLibraryItems({ type: 'plan-review-instruction', scope: 'global', enabledOnly: true })[0];
  return item ? readItemContent(item) : DEFAULT_PLAN_REVIEW_INSTRUCTION;
}

/**
 * Project and group levels of the instruction were replaced by plan-review skills.
 * Once: each such text becomes a skill of the same level with the same content.
 */
export function migratePlanReviewInstructionLevels(): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'plan-review-levels-to-skills'").get()) return;
  for (const item of listLibraryItems({ type: 'plan-review-instruction', scope: 'project' })) {
    const content = readItemContent(item);
    deleteItemContent(item);
    const moved = updateLibraryItem(item.id, { type: 'plan-review-skill', slug: 'plan_review_' + item.id.slice(0, 8), title: 'Требования к плану', description: '' });
    if (moved) writeItemContent(moved, content);
  }
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('plan-review-levels-to-skills', '1', datetime('now'))").run();
}
