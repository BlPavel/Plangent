import { finishes, getFinish } from '../../../core/git/finish';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_finish_context: { description: 'Read changed files, diffs, commit rules, task context, options and user revision note. Call first.', fields: {} },
set_commits: { description: 'Submit the full commit list. Include each changed file exactly once. Plangent creates commits. Correct errors and retry.', fields: {
    commits: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['files','title'], properties: {
      files: { type: 'array', minItems: 1, items: { type: 'string' } }, title: { type: 'string' }, body: { type: 'string' },
    } } },
  } },
finish_commits: { description: 'Finish preparing commits. Plangent either asks the user to review them or automatically completes the selected scenario, according to options.autoContinue. Never push yourself.', fields: {} },
set_merge_request: { description: 'Full cycle only: write the merge request. Give the title (one line) and the description following the template from the context. It is reviewed with the commits unless automatic completion is enabled; Plangent sets target branch, reviewers, assignees, labels and options and creates the MR after the push.', fields: { title: { type: 'string' }, description: { type: 'string' } } }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const service = finishes(), runId = service.agentRun(session);
const result = name === 'get_finish_context' ? await service.context(runId)
          : name === 'set_merge_request' ? await service.setMergeRequest(runId, args.title, args.description)
          : name === 'set_commits' ? await service.setCommits(runId, args.commits, true)
          : await service.finishCommits(runId);
emit(name, { finish_id: runId });
return result;
}
export const tools = defineTools(definitions, {
get_finish_context: { roles: {"committer":0,"committer-full":0}, required: [], validateStrings: [] },
set_commits: { roles: {"committer":1,"committer-full":1}, required: ["commits"], validateStrings: [] },
finish_commits: { roles: {"committer":2,"committer-full":2}, required: [], validateStrings: [] },
set_merge_request: { roles: {"committer-full":3}, required: ["title","description"], validateStrings: ["title","description"] }
}, handle);
