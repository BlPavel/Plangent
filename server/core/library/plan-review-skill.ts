import { reviewSkillsOf, resolveReviewSkillOf } from './section-settings';
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
  return reviewSkillsOf('plan-review-skill', projectId);
}

/** The chosen skill's text; an unknown or unavailable one falls back to the project's first skill, and without any there is none. */
export function resolvePlanReviewSkill(projectId: string, skillId?: string | null): { id: string; title: string; content: string } | null {
  return resolveReviewSkillOf('plan-review-skill', projectId, skillId);
}
