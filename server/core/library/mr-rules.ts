import { DEFAULT_MR_RULES } from './builtins';
export { DEFAULT_MR_RULES } from './builtins';
import { resolveInstructionText } from './section-settings';

/**
 * How the agent writes a merge request title and description. Like the commit rules, the nearest level wins:
 * project, group, global (Settings → Git → МР); when none is set, the built-in text applies.
 */
export function resolveMrRules(projectId: string): string {
  return resolveInstructionText('mr-rules', projectId, DEFAULT_MR_RULES);
}
