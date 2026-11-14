import { agentView as branchQuestions, agentReply as branchReply } from '../../../core/review/branch/questions';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_branch_questions: { description: 'Read the questions of the developer about the reviewed branch: threads waiting for you (assigned, with history), the rules (protocol) and other threads as context. Call first.', fields: {} },
reply_branch_question: {
    description: 'Reply in a question thread of the branch review; the thread then waits for the developer. kind: answer (plain reply), options (approaches as a numbered list with your recommendation), questions (clarifying questions). One reply per thread per turn.',
    fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions'] }, text: { type: 'string' } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_branch_questions' ? branchQuestions(session) : branchReply(session, String(args.id ?? ''), args);
if (name === 'reply_branch_question') emit(name, { item_id: String(args.id), kind: args.kind, text: args.text });
return result;
}
export const tools = defineTools(definitions, {
get_branch_questions: { roles: {"branch-review":1}, required: [], validateStrings: [] },
reply_branch_question: { roles: {"branch-review":2}, required: ["id","kind","text"], validateStrings: ["id","kind","text"] }
}, handle);
