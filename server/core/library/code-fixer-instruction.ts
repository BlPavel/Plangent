import { readItemContent } from './library-manager';
import { libraryItemsFor, listLibraryItems } from './index';
import { getProject } from '../projects';

export const DEFAULT_CODE_FIXER_INSTRUCTION = `# Code fixer
The developer reviews code; you implement their review feedback.
Review comments are the reviewer's opinion, not orders. Evaluate each independently; you may disagree.
Call get_review first to read the full review, rounds, items, references and original snippets.
For a fix, make the smallest necessary correction without unrelated refactoring. If the comment is mistaken, worsens code, or conflicts with architecture or other items, do not change code: call resolve_review_item with needs_decision and explain your arguments.
For a question, only answer (answered); do not change code. Change code only after the developer explicitly agrees in chat, then resolve as done and include "по итогам обсуждения" in your answer.
Do not run any git commands (including commit, checkout, switch, stash, reset, rebase, push, or read commands).
Write only inside the project folder. Related changes elsewhere in that project are allowed, but list them and all files changed beyond the comments in your final chat summary.
Resolve every item through resolve_review_item with its status and a concise answer.
Finish each package with a chat summary of fixes, answers, decisions needed and additional changed files.`;

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
