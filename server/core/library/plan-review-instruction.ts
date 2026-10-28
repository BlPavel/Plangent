import { readItemContent, writeItemContent, takeLegacyPlanReviewContent } from './library-manager';
import { libraryItemsFor, listLibraryItems, updateLibraryItem } from './index';
import { getProject } from '../projects';
import { getDb } from '../../infrastructure/db/schema';

/**
 * The developer's rules for reviewing a plan: what to check and what to skip. How cards, the overview and
 * the coverage table are written is Plangent's protocol (PROTOCOL, tool descriptions), so it is not part of this text.
 */
export const DEFAULT_PLAN_REVIEW_INSTRUCTION = `# Plan review
1. Check that the steps do not contradict each other or the analysis materials.
2. Check that the order is executable: everything step N+1 needs exists after step N, and no step depends on a later one. Parallel steps must not change the same files.
3. Match every requirement of the analysis to the steps. Find requirements nobody covers and work that does not follow from the task materials.
4. Check that every step can be verified: its description must make clear when it is done.
Back every remark with concrete steps and materials. Suggest a fix when it is clear.`;

/** Nearest level wins: project, group, global; without any of them the built-in text applies. */
export function resolvePlanReviewInstruction(projectId: string): string {
  const project = getProject(projectId);
  const items = project
    ? libraryItemsFor(project, 'plan-review-instruction').filter(item => item.enabled)
    : listLibraryItems({ type: 'plan-review-instruction', projectId: '', enabledOnly: true }).map(item => ({ ...item, origin: 'global' as const }));
  const item = (['direct', 'group', 'global'] as const).map(origin => items.find(i => i.origin === origin)).find(Boolean);
  return item ? readItemContent(item) : DEFAULT_PLAN_REVIEW_INSTRUCTION;
}

/**
 * Plan review used to be a choice among skills; it is now one instruction per level, like the code fixer's.
 * Once: the first old skill of each level becomes that level's instruction, the rest and the unedited preset go.
 */
export function migratePlanReviewSkills(): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'plan-review-instruction-migrated'").get()) return;
  const legacy = listLibraryItems({ type: 'plan-review-skill' as never });
  const seen = new Set<string>();
  for (const item of legacy) {
    const level = item.scope + ':' + [...item.targets].sort().join(',');
    const content = takeLegacyPlanReviewContent(item);
    const preset = item.slug === 'default' && item.title === 'Стандартный';
    if (preset || seen.has(level)) { db.prepare('DELETE FROM library_items WHERE id = ?').run(item.id); continue; }
    seen.add(level);
    const moved = updateLibraryItem(item.id, { type: 'plan-review-instruction', slug: 'plan_review_instruction', title: 'Ревью плана', description: '' });
    if (moved) writeItemContent(moved, content);
  }
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('plan-review-instruction-migrated', '1', datetime('now'))").run();
}
