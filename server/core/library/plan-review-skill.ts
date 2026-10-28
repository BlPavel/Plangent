import { readItemContent } from './library-manager';
import { getLibraryItem, libraryItemsFor, libraryOrigin } from './index';
import { getProject } from '../projects';
import type { LibraryOrigin } from './index';

/**
 * Plan-review skills are the project's or group's own requirements for a plan (architecture rules and the like).
 * They come on top of the global review instruction, which holds the general checks and always applies.
 */
export const PLAN_REVIEW_SKILL_AUTHORING = 'A plan-review-skill (type "plan-review-skill") is the developer\'s own requirements for reviewing task plans of this project or group: ' +
  'architecture rules, module boundaries, conventions a plan must respect. The general checks (contradictions, order, coverage) are already given by the global review instruction, so do not repeat them. ' +
  'It is never synced to agent folders; the description is a one-line summary shown in the picker. Plangent defines the output protocol; do not put an output format in the skill.';

export interface PlanReviewSkill { id: string; title: string; description: string; origin: LibraryOrigin }

/** Plan-review skills that apply to a project: its own, its group's and global ones. */
export function planReviewSkills(projectId: string): PlanReviewSkill[] {
  const project = getProject(projectId);
  if (!project) return [];
  const order = { direct: 0, group: 1, global: 2 };
  return libraryItemsFor(project, 'plan-review-skill').filter(item => item.enabled)
    .sort((a, b) => order[a.origin] - order[b.origin])
    .map(item => ({ id: item.id, title: item.title, description: item.description, origin: item.origin }));
}

/** The chosen skill's text; an unknown or unavailable one falls back to the project's first skill, and without any there is none. */
export function resolvePlanReviewSkill(projectId: string, skillId?: string | null): { id: string; title: string; content: string } | null {
  const project = getProject(projectId);
  const chosen = skillId ? getLibraryItem(skillId) : null;
  const item = chosen && chosen.type === 'plan-review-skill' && chosen.enabled && project && libraryOrigin(chosen, project) ? chosen
    : (() => { const first = planReviewSkills(projectId)[0]; return first ? getLibraryItem(first.id) : null; })();
  return item ? { id: item.id, title: item.title, content: readItemContent(item) } : null;
}
