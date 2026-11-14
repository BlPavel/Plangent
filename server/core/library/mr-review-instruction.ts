import { DEFAULT_MR_REVIEW_INSTRUCTION } from './builtins';
export { DEFAULT_MR_REVIEW_INSTRUCTION } from './builtins';
import { resolveInstructionText } from './section-settings';

/**
 * The general checks of every merge request review (by the review agent of a branch or of a task). Like the code-fixer instruction,
 * the nearest level wins: the project, its group, the global text, the built-in one.
 * A project's or group's own requirements can also be review skills (review-skill.ts) that come on top.
 * How the overview and the remarks are reported is Plangent's protocol, not part of the text.
 */
export function resolveMrReviewInstruction(projectId: string): string {
  return resolveInstructionText('mr-review-instruction', projectId, DEFAULT_MR_REVIEW_INSTRUCTION);
}
