import { DEFAULT_COMMIT_RULES } from './builtins';
export { DEFAULT_COMMIT_RULES } from './builtins';
import { readItemContent } from './library-manager';
import { resolveLibraryItem } from './section-settings';

/**
 * The commit-message rules every agent follows when it writes commits. Like the code-fixer instruction, the nearest level
 * wins: project, group, global (Settings → Коммиты); when none is set, this built-in text applies.
 */


export function resolveCommitRules(projectId?: string): string {
  const item = resolveLibraryItem('commit-rules', projectId);
  return (item ? readItemContent(item).trim() : '') || DEFAULT_COMMIT_RULES;
}
