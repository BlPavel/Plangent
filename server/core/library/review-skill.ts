import { DEFAULT_REVIEW_SKILL } from './builtins';
export { DEFAULT_REVIEW_SKILL } from './builtins';
import { libraryItemsFor } from './index';
import { resolveReviewSkillOf } from './section-settings';
import { getProject } from '../projects';
import type { LibraryOrigin } from './index';

/**
 * Review skills tell the review agent what matters in a merge request of this project and what to skip.
 * How the overview and the remarks are reported is Plangent's protocol (get_review_brief), not part of a skill.
 */


/** For the librarian: what a review skill is, so it can write one for the project. */
export const REVIEW_SKILL_AUTHORING = 'A review-skill (type "review-skill") is the developer\'s focus for reviewing merge requests of this project or group with an agent: ' +
  'what to check (architecture rules, module boundaries, contracts, risky areas of this codebase) and what to ignore. Ground it in the real code and ask the developer what matters to them. ' +
  'It is not synced to agent folders and has no "when to apply" trigger; the description is a one-line summary shown in the picker. Do not describe output format: Plangent defines how the overview and remarks are reported.';

export interface ReviewSkill { id: string; title: string; description: string; origin: LibraryOrigin }

/** Review skills that apply to a project: its own, its group's and global ones. */
export function reviewSkills(projectId: string): ReviewSkill[] {
  const project = getProject(projectId);
  if (!project) return [];
  const order = { direct: 0, group: 1, global: 2 };
  return libraryItemsFor(project, 'review-skill').filter(item => item.enabled)
    .sort((a, b) => order[a.origin] - order[b.origin])
    .map(item => ({ id: item.id, title: item.title, description: item.description, origin: item.origin }));
}

/** The chosen skill's text; an unknown or unavailable one falls back to the project's first skill, then to the default. */
export function resolveReviewSkill(projectId: string, skillId: string | null | undefined): { id: string | null; title: string; content: string } {
  return resolveReviewSkillOf('review-skill', projectId, skillId) ?? { id: null, title: 'Стандартный', content: DEFAULT_REVIEW_SKILL };
}
