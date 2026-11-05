import { conflictBrief, reportConflictFile } from '../../../core/git/conflicts';
import path from 'path';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_conflicts: { description: 'Read the merge/rebase conflicts to resolve: the rules (protocol), the operation, whose changes are ours/theirs (sides), the conflicted files, your earlier notes and the developer\'s answers. Call first.', fields: {} },
report_conflict_file: {
    description: 'Report one conflicted file. outcome resolved: you merged it, no conflict markers left; text says only which conflict it was and how you resolved it, no next steps. question: you are unsure; text is your question. recommend: it cannot be fixed by editing text (deleted on one side, binary, lock file); text is your advice.',
    fields: { path: { type: 'string' }, outcome: { type: 'string', enum: ['resolved', 'question', 'recommend'] }, text: { type: 'string' } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_conflicts' ? await conflictBrief(session) : await reportConflictFile(session, args);
if (name === 'report_conflict_file') emit(name, { summary: String(args.path) + ': ' + String(args.outcome) });
return result;
}
export const tools = defineTools(definitions, {
get_conflicts: { roles: {"conflict-resolver":0}, required: [], validateStrings: [] },
report_conflict_file: { roles: {"conflict-resolver":1}, required: ["path","outcome","text"], validateStrings: ["path","outcome","text"] }
}, handle);
