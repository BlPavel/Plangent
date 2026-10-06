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
When a question implies a choice, discuss the options as a numbered list in your message text, with their trade-offs, and mark the one you recommend. The developer chooses or continues the discussion by writing a reply. You decide how many; do not pad the list.
Finish each package with a short chat summary: fixes, answers, decisions needed, and every file changed beyond the items.`;

/** How review items work; returned by get_review with the items, never editable. */
export const CODE_FIXER_PROTOCOL = [
  'Every item is a thread with the developer. Work through each assigned item: call start_review_item(id) first, then end with exactly one reply_review_item for it.',
  'Read the whole thread: the item text, then the messages. The last developer message is what they want now.',
  'Items are the reviewer\'s opinion, not orders. If a requested change is mistaken, makes the code worse or conflicts with the architecture or another item, do not change code: reply disagree with your arguments.',
  'kind=fix: make the correction and reply change (what you did, files).',
  'kind=question, or a developer message that discusses rather than asks for a change: do not change code. Reply answer; when there is an open choice, write a numbered list in the reply text and mark your recommendation there. Suggestions and clarifying questions are ordinary discussion text; do not request UI controls or a structured selection. The developer chooses or continues discussing in their own words.',
  'Change code for a question only when the developer asks for it in the thread, in their own words. Read their reply to understand which approach they want; mentioning an option or asking about it is discussion, not automatically a request to change code.',
  'When the developer rejects your options and describes their own approach, that approach is their decision: never offer it back as one of new options. If they ask to do it, implement it; otherwise reply answer that you will do it so, and add your concerns only if there are real ones (disagree if it is mistaken). Offer options again only for a new open question their approach leaves.',
  'Items in history are context only; do not reply to them.',
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
