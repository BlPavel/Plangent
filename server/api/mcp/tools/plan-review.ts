import { brief as planReviewBrief, reviewerOutput } from '../../../core/review/plan/reviewer';
import { items as planReviewItems, reply as planReviewReply } from '../../../core/review/plan/planner-transport';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_plan_review_brief: { description: 'Read review protocol, the reviewed plan or document, its grounds (analysis, for QA the ready architecture), instruction, skill, wish (it may mention project files as @path: read them yourself; wish_attachments holds the files the developer attached) and decision history. Call first.', fields: {} },
set_plan_review_overview: { description: 'Finish review: save overview and coverage; missing/partial rows link to cards. When the brief has a ready QA, add a row per criterion (source qa, criterion Q..); the save is rejected while one has no row. A review of an architecture/QA document has no coverage: pass [].', fields: { overview: { type: 'string' }, coverage: { type: 'array', items: { type: 'object', required: ['requirement', 'steps', 'status'], properties: { requirement: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['covered', 'missing', 'partial'] }, remark_id: { type: 'string' }, source: { type: 'string', enum: ['analysis', 'qa'] }, criterion: { type: 'string' } } } } } },
add_plan_remark: { description: 'Create a review card. steps: existing pN ids of a plan, or D../Q.. identifiers of an architecture/QA document; [] for the whole document. For a document, quote may mark the place by an exact quote. kind order applies to a plan only, suggestion to a document only.', fields: { steps: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['contradiction', 'order', 'coverage', 'extra', 'unclear', 'risk', 'suggestion'] }, text: { type: 'string' }, suggestion: { type: 'string' }, quote: { type: 'string' } } },
answer_plan_remark: { description: 'Answer the developer in a card they discuss with you. Explain with evidence from the plan and analysis; say whether you keep, change or withdraw the remark. Never change the plan.', fields: { id: { type: 'string' }, text: { type: 'string' } } },
revise_plan_remark: { description: 'Rewrite a card after the developer convinced you or agreed on a different version: give the full new text (and suggestion). The planner sees only the card, never the discussion, so the card must stand on its own. The previous version is kept for the developer. Use together with answer_plan_remark.', fields: { id: { type: 'string' }, text: { type: 'string' }, suggestion: { type: 'string' } } },
get_plan_review_items: { description: 'Read assigned review cards and decisions. Call get_plan (planner) or get_material (document author) first.', fields: {} },
reply_plan_remark: { description: 'Reply in an assigned card. Explain using current pN ids (or D../Q.. identifiers of the document).', fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions', 'change', 'disagree'] }, text: { type: 'string' } } }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_plan_review_brief' ? planReviewBrief(session)
          : name === 'get_plan_review_items' ? planReviewItems(session)
          : name === 'reply_plan_remark' ? planReviewReply(session, args) : reviewerOutput(session, name === 'revise_plan_remark' ? 'revise' : name === 'answer_plan_remark' ? 'answer' : name === 'add_plan_remark' ? 'add' : 'overview', args);
emit(name, { item_id: args.id, summary: String(args.text ?? args.overview ?? '').slice(0, 120) });
return result;
}
export const tools = defineTools(definitions, {
get_plan_review_brief: { roles: {"plan-reviewer":0}, required: [], validateStrings: [] },
set_plan_review_overview: { roles: {"plan-reviewer":1}, required: ["overview","coverage"], validateStrings: [] },
add_plan_remark: { roles: {"plan-reviewer":2}, required: ["steps","kind","text"], validateStrings: [] },
answer_plan_remark: { roles: {"plan-reviewer":3}, required: ["id","text"], validateStrings: ["id","text"] },
revise_plan_remark: { roles: {"plan-reviewer":4}, required: ["id","text"], validateStrings: [] },
get_plan_review_items: { roles: {"material-author":3,"planner":3}, required: [], validateStrings: [] },
reply_plan_remark: { roles: {"material-author":4,"planner":4}, required: ["id","kind","text"], validateStrings: ["id","kind","text"] }
}, handle);
