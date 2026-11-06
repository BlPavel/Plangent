import { DEFAULT_MR_REVIEW_INSTRUCTION } from './builtins';
export { DEFAULT_MR_REVIEW_INSTRUCTION } from './builtins';
import { resolveGlobalText } from './section-settings';

/**
 * The general checks of every merge request review (by the review agent of a branch or of a task), written once in the settings.
 * A project's or group's own requirements are review skills (review-skill.ts) that come on top.
 * How the overview and the remarks are reported is Plangent's protocol, not part of the text.
 */

/** The global text; without one the built-in text applies. */
export function resolveMrReviewInstruction(): string {
  return resolveGlobalText('mr-review-instruction', DEFAULT_MR_REVIEW_INSTRUCTION);
}
