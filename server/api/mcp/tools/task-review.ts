import { taskReviewBrief, addTaskRemark, submitTaskReview } from '../../../core/review/code/task-review';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_task_review_brief: { description: 'Read task review protocol, skill, captured task diff, analysis, plan, executor reports and existing branch review items. Call first.', fields: {} },
add_task_remark: { description: 'Create an agent draft in Code. Lines refer to the current worktree. Invalid lines become file remarks.', fields: {
    scope: { type: 'string', enum: ['line', 'file', 'general'] }, kind: { type: 'string', enum: ['fix', 'question'] }, text: { type: 'string' },
    file: { type: 'string' }, line_start: { type: 'integer', minimum: 1 }, line_end: { type: 'integer', minimum: 1 },
  } },
submit_task_review: { description: 'Complete the task review with a short summary. The queue continues without waiting for findings to be resolved.', fields: { summary: { type: 'string' } } }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_task_review_brief' ? await taskReviewBrief(session)
          : name === 'add_task_remark' ? await addTaskRemark(session, args) : await submitTaskReview(session, args.summary);
emit(name, { summary: String(args.text ?? args.summary ?? '').slice(0, 120) });
return result;
}
export const tools = defineTools(definitions, {
get_task_review_brief: { roles: {"task-reviewer":0}, required: [], validateStrings: [] },
add_task_remark: { roles: {"task-reviewer":1}, required: ["scope","kind","text"], validateStrings: [] },
submit_task_review: { roles: {"task-reviewer":2}, required: ["summary"], validateStrings: ["summary"] }
}, handle);
