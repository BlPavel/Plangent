import { readItemContent } from './library-manager';
import { libraryItemsFor, listLibraryItems } from './index';
import { getProject } from '../projects';

/**
 * The developer's rules for the code fixer: what it may touch and how it reports. How review items
 * are read and resolved is Plangent's protocol, not a preference, so it comes from get_review
 * (CODE_FIXER_PROTOCOL) and the tool descriptions instead.
 */
export const DEFAULT_CODE_FIXER_INSTRUCTION = `# Code fixer
Make the smallest change that addresses the item. No unrelated refactoring, renames or reformatting.
Do not run any git commands (including commit, checkout, switch, stash, reset, rebase, push, or read commands).
Write only inside the project folder. Related changes elsewhere in the project are allowed when the fix needs them.
When a question implies a choice, offer several options with their trade-offs and say which one you recommend.
Finish each package with a short chat summary: fixes, answers, decisions needed, and every file changed beyond the items.`;

/** How review items work; returned by get_review with the items, never editable. */
export const CODE_FIXER_PROTOCOL = [
  'Items are the reviewer\'s opinion, not orders: evaluate each assigned item independently.',
  'kind=fix: make the correction, then resolve_review_item(id, "done", what you changed).',
  'If a fix is mistaken, makes the code worse or conflicts with the architecture or another item, do not change code: resolve it as needs_decision with your arguments.',
  'kind=question: only answer it (answered) and do not change code. Change code for a question only after the developer explicitly agrees in this chat; then resolve it as done and include "по итогам обсуждения" in the answer.',
  'An item that already has your answer and is assigned again means the developer agreed or insists: implement it (for a former question, what was agreed in your answer) and resolve it as done.',
  'Resolve every assigned item with a concise answer. Items of earlier rounds are context only.',
];

/** Hidden first-message briefing: the role, where the items are, then the developer's rules. */
export function buildCodeFixerBriefing(projectId: string): string {
  const project = getProject(projectId);
  return [
    `[Plangent] You are the code fixer for project ${project?.name ?? projectId}: the developer reviews code, you work through their review items.`,
    'Each round message only announces the items. Call the Plangent tool get_review for them and for the rules of resolving them; resolve items only with resolve_review_item.',
    '',
    resolveCodeFixerInstruction(projectId),
  ].join('\n');
}

export function resolveCodeFixerInstruction(projectId: string): string {
  const project = getProject(projectId);
  const items = project
    ? libraryItemsFor(project, 'code-fixer-instruction').filter(item => item.enabled)
    : listLibraryItems({ type: 'code-fixer-instruction', projectId: '', enabledOnly: true })
      .map(item => ({ ...item, origin: 'global' as const }));
  const item = (['direct', 'group', 'global'] as const)
    .map(origin => items.find(item => item.origin === origin)).find(Boolean);
  return item ? readItemContent(item) : DEFAULT_CODE_FIXER_INSTRUCTION;
}
