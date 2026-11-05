import { brief as reviewBrief, setOverview as setReviewOverview } from '../../../core/review/branch/brief';
import { agentRemark } from '../../../core/review/branch/remarks';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_review_brief: { description: 'Read the review of the merge request: the rules (protocol), the compared range, the MR description, the developer\'s context and review skill, colleagues\' threads and existing remarks. Call first.', fields: {} },
set_review_overview: { description: 'Save the overview of the merge request (markdown): what changes and why, how the parts connect, what to look at. Replaces the previous overview.', fields: { text: { type: 'string' } } },
add_review_remark: {
    description: 'Add a draft remark for the developer to edit and publish. With path and line it is attached to that line of the diff (side old for a removed line); without path it is about the whole merge request. text is the ready comment in the developer\'s voice.',
    fields: { text: { type: 'string' },
      path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, side: { type: 'string', enum: ['new', 'old'] } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_review_brief' ? await reviewBrief(session) : name === 'set_review_overview' ? await setReviewOverview(session, args.text) : await agentRemark(session, args);
if (name === 'set_review_overview') emit(name, { summary: 'Сводка МР сохранена' });
if (name === 'add_review_remark') emit(name, { summary: 'Черновик замечания: ' + String(args.text ?? '').slice(0, 120) });
return result;
}
export const tools = defineTools(definitions, {
get_review_brief: { roles: {"branch-review":0}, required: [], validateStrings: [] },
set_review_overview: { roles: {"branch-review":3}, required: ["text"], validateStrings: ["text"] },
add_review_remark: { roles: {"branch-review":4}, required: ["text"], validateStrings: [] }
}, handle);
