import { reviews } from '../../../core/review/code/reviews';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_review: { description: 'Read the review threads waiting for you (assigned, each with its whole thread), the rules (protocol) and other items as context (history). Call first in every round.', fields: {} },
start_review_item: { description: 'Say which assigned item you start working on, before reading or changing code for it; permission requests then show in that item.', fields: { id: { type: 'string' } } },
reply_review_item: {
    description: 'Reply in an assigned item\'s thread; the thread then waits for the developer. kind: answer (plain reply), options (discuss approaches as a numbered list in text, marking your recommendation), questions (clarifying questions in text), change (you changed code: say what, list files), disagree (you will not do it: give arguments). The developer replies in their own words; all suggestions belong in text.',
    fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions', 'change', 'disagree'] }, text: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_review' ? await reviews(session.metadata.workspace_id as string | undefined, ['task-chat', 'errand'].includes(session.role) ? session.task_id ?? undefined : undefined).getAgentReview(session)
          : name === 'start_review_item' ? reviews(session.metadata.workspace_id as string | undefined, ['task-chat', 'errand'].includes(session.role) ? session.task_id ?? undefined : undefined).focusItem(session, String(args.id))
          : await reviews(session.metadata.workspace_id as string | undefined, ['task-chat', 'errand'].includes(session.role) ? session.task_id ?? undefined : undefined).replyItem(session, String(args.id ?? ''), args);
if (name === 'start_review_item') emit('review_focus', { item_id: String(args.id) });
if (name === 'reply_review_item') emit(name, { item_id: String(args.id), kind: args.kind, text: args.text });
return result;
}
export const tools = defineTools(definitions, {
get_review: { roles: {"errand":3,"task-chat":2,"code-fixer":0}, required: [], validateStrings: [] },
start_review_item: { roles: {"errand":4,"task-chat":3,"code-fixer":1}, required: ["id"], validateStrings: ["id"] },
reply_review_item: { roles: {"errand":5,"task-chat":4,"code-fixer":2}, required: ["id","kind","text"], validateStrings: [] }
}, handle);
