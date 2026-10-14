import { readItemContent } from './library-manager';
import { libraryItemsFor, listLibraryItems } from './index';
import { getProject } from '../projects';

/**
 * The commit-message rules every agent follows when it writes commits. Like the code-fixer instruction, the nearest level
 * wins: project, group, global (Settings → Коммиты); when none is set, this built-in text applies.
 */
export const DEFAULT_COMMIT_RULES = [
  'Write the commit message in English.',
  'Title: one short line in the imperative mood that says what was done, for example "Add retry to payment client".',
  'Keep the title under 10 words (never more than 72 characters) and do not end it with a period.',
  'Describe the change itself, not the files or the process. Do not mention the AI, the agent or the tool.',
  'Description (only when requested): 1-3 short lines or bullets on what changed and why.',
].join('\n');

export function resolveCommitRules(projectId?: string): string {
  const project = projectId ? getProject(projectId) : null;
  const items = project
    ? libraryItemsFor(project, 'commit-rules').filter(item => item.enabled)
    : listLibraryItems({ type: 'commit-rules', projectId: '', enabledOnly: true }).map(item => ({ ...item, origin: 'global' as const }));
  const item = (['direct', 'group', 'global'] as const).map(origin => items.find(item => item.origin === origin)).find(Boolean);
  return (item ? readItemContent(item).trim() : '') || DEFAULT_COMMIT_RULES;
}
