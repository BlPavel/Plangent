import type { ToolCallUpdate } from '@agentclientprotocol/sdk';

/** Tools the Plangent MCP server gives agents (served by infrastructure/mcp/server.ts). */
export const plangentTools = {
  get_task_review_brief: { description: 'Read task review protocol, skill, captured task diff, analysis, plan, executor reports and existing branch review items. Call first.', fields: {} },
  add_task_remark: { description: 'Create an agent draft in Code. Lines refer to the current worktree. Invalid lines become file remarks.', fields: {
    scope: { type: 'string', enum: ['line', 'file', 'general'] }, kind: { type: 'string', enum: ['fix', 'question'] }, text: { type: 'string' },
    file: { type: 'string' }, line_start: { type: 'integer', minimum: 1 }, line_end: { type: 'integer', minimum: 1 },
  } },
  submit_task_review: { description: 'Complete the task review with a short summary. The queue continues without waiting for findings to be resolved.', fields: { summary: { type: 'string' } } },
  get_plan_review_brief: { description: 'Read review protocol, plan, analysis, skill, wish and decision history. Call first.', fields: {} },
  set_plan_review_overview: { description: 'Finish review: save overview and coverage; missing/partial rows link to cards.', fields: { overview: { type: 'string' }, coverage: { type: 'array', items: { type: 'object', required: ['requirement', 'steps', 'status'], properties: { requirement: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['covered', 'missing', 'partial'] }, remark_id: { type: 'string' } } } } } },
  add_plan_remark: { description: 'Create a plan card. steps: existing pN ids, [] for the whole plan.', fields: { steps: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['contradiction', 'order', 'coverage', 'extra', 'unclear', 'risk'] }, text: { type: 'string' }, suggestion: { type: 'string' } } },
  answer_plan_remark: { description: 'Answer the developer in a card they discuss with you. Explain with evidence from the plan and analysis; say whether you keep, change or withdraw the remark. Never change the plan.', fields: { id: { type: 'string' }, text: { type: 'string' } } },
  revise_plan_remark: { description: 'Rewrite a card after the developer convinced you or agreed on a different version: give the full new text (and suggestion). The planner sees only the card, never the discussion, so the card must stand on its own. The previous version is kept for the developer. Use together with answer_plan_remark.', fields: { id: { type: 'string' }, text: { type: 'string' }, suggestion: { type: 'string' } } },
  get_plan_review_items: { description: 'Read assigned cards with threads and decisions. Call get_plan first.', fields: {} },
  reply_plan_remark: { description: 'Reply in an assigned card. Explain using current pN ids.', fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions', 'change', 'disagree'] }, text: { type: 'string' } } },
  get_finish_context: { description: 'Read changed files, diffs, commit rules, task context, options and user revision note. Call first.', fields: {} },
  set_commits: { description: 'Submit the full commit list. Include each changed file exactly once. Plangent creates commits. Correct errors and retry.', fields: {
    commits: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['files','title'], properties: {
      files: { type: 'array', minItems: 1, items: { type: 'string' } }, title: { type: 'string' }, body: { type: 'string' },
    } } },
  } },
  finish_commits: { description: 'Finish preparing commits. Plangent either asks the user to review them or automatically completes the selected scenario, according to options.autoContinue. Never push yourself.', fields: {} },
  set_merge_request: { description: 'Full cycle only: write the merge request. Give the title (one line) and the description following the template from the context. It is reviewed with the commits unless automatic completion is enabled; Plangent sets target branch, reviewers, assignees, labels and options and creates the MR after the push.', fields: { title: { type: 'string' }, description: { type: 'string' } } },
  get_library: { description: 'Get the project library catalog, instruction authoring guide and available levels. Call first.', fields: {} },
  get_library_item: { description: 'Read an available library item, including content.', fields: { id: { type: 'string' } } },
  propose_library_change: {
    description: 'Save a library proposal for developer review. Preserve type and slug on update; supply item_id. Availability defaults to project for new items and group copies.',
    fields: { proposal: { type: 'object', additionalProperties: false,
      required: ['action', 'type', 'slug', 'title', 'content', 'explanation'],
      properties: {
        action: { type: 'string', enum: ['create', 'update'] }, type: { type: 'string', enum: ['skill', 'main', 'command', 'review-skill', 'plan-review-skill'] },
        slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, frontmatter: { type: 'object' },
        content: { type: 'string' }, explanation: { type: 'string' }, item_id: { type: 'string' },
        scope: { type: 'string', enum: ['global', 'project'] }, targets: { type: 'array', items: { type: 'string' } },
        own_only: { type: 'array', items: { type: 'string' } },
      },
    } },
  },
  complete_step: { description: 'Finish all assigned steps with a summary.', fields: { summary: { type: 'string' } } },
  request_help: { description: 'Ask the developer for help.', fields: { question: { type: 'string' } } },
  report_progress: { description: 'Report progress.', fields: { note: { type: 'string' } } },
  get_review: { description: 'Read the review threads waiting for you (assigned, each with its whole thread), the rules (protocol) and other items as context (history). Call first in every round.', fields: {} },
  start_review_item: { description: 'Say which assigned item you start working on, before reading or changing code for it; permission requests then show in that item.', fields: { id: { type: 'string' } } },
  reply_review_item: {
    description: 'Reply in an assigned item\'s thread; the thread then waits for the developer. kind: answer (plain reply), options (discuss approaches as a numbered list in text, marking your recommendation), questions (clarifying questions in text), change (you changed code: say what, list files), disagree (you will not do it: give arguments). The developer replies in their own words; all suggestions belong in text.',
    fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions', 'change', 'disagree'] }, text: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } } },
  },
  get_branch_questions: { description: 'Read the questions of the developer about the reviewed branch: threads waiting for you (assigned, with history), the rules (protocol) and other threads as context. Call first.', fields: {} },
  reply_branch_question: {
    description: 'Reply in a question thread of the branch review; the thread then waits for the developer. kind: answer (plain reply), options (approaches as a numbered list with your recommendation), questions (clarifying questions). One reply per thread per turn.',
    fields: { id: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'options', 'questions'] }, text: { type: 'string' } },
  },
  get_review_brief: { description: 'Read the review of the merge request: the rules (protocol), the compared range, the MR description, the developer\'s context and review skill, colleagues\' threads and existing remarks. Call first.', fields: {} },
  set_review_overview: { description: 'Save the overview of the merge request (markdown): what changes and why, how the parts connect, what to look at. Replaces the previous overview.', fields: { text: { type: 'string' } } },
  add_review_remark: {
    description: 'Add a draft remark for the developer to edit and publish. With path and line it is attached to that line of the diff (side old for a removed line); without path it is about the whole merge request. text is the ready comment in the developer\'s voice.',
    fields: { text: { type: 'string' },
      path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, side: { type: 'string', enum: ['new', 'old'] } },
  },
  get_conflicts: { description: 'Read the merge/rebase conflicts to resolve: the rules (protocol), the operation, whose changes are ours/theirs (sides), the conflicted files, your earlier notes and the developer\'s answers. Call first.', fields: {} },
  report_conflict_file: {
    description: 'Report one conflicted file. outcome resolved: you merged it, no conflict markers left; text says only which conflict it was and how you resolved it, no next steps. question: you are unsure; text is your question. recommend: it cannot be fixed by editing text (deleted on one side, binary, lock file); text is your advice.',
    fields: { path: { type: 'string' }, outcome: { type: 'string', enum: ['resolved', 'question', 'recommend'] }, text: { type: 'string' } },
  },
  get_analysis: { description: 'Get analysis sections, descriptions and attachment paths. Call before analyzing.', fields: {} },
  save_section: {
    description: 'Save an analysis section. Omit slug to create; supply existing slug to update. Defaults to worked, author agent. Source or developer material edits require an explicit developer request and source_requested=true.',
    fields: { title: { type: 'string' }, description: { type: 'string' }, slug: { type: 'string' },
      kind: { type: 'string', enum: ['source', 'worked'] }, source_requested: { type: 'boolean' } },
  },
  get_plan: { description: 'Get the task, its current plan (if any), the plan template and the plan format rules. Call it before writing a plan.', fields: {} },
  submit_plan: {
    description: 'Save the whole plan (markdown). Every tracked step is its own line "- [ ] step text"; everything else (headings, notes) is free text. ' +
      'Keep existing "(pN)" ids of steps you keep; leave ids out for new steps - Plangent numbers them. Call again with the full plan after every change.',
    fields: { content: { type: 'string' } },
  },
};
export type PlangentTool = keyof typeof plangentTools;

const signatures = Object.values(plangentTools).map(t => Object.keys(t.fields).sort().join(','));

/**
 * Whether a permission request is for one of Plangent's own tools. The MCP server already checks the
 * session's role, so asking the developer about them (or denying them to a read-only reviewer) only
 * stalls the queue. Some agents name the tool (`mcp__plangent__complete_step`); Gemini-family agents
 * (GigaCode, Qwen) send just the arguments, with the title being those arguments as JSON.
 */
export function isPlangentToolCall(tool: Pick<ToolCallUpdate, 'title' | 'kind' | 'rawInput'>): boolean {
  const title = tool.title ?? '';
  if (/plangent/i.test(title) && Object.keys(plangentTools).some(name => title.includes(name))) return true;
  const input = tool.rawInput;
  // Codex: { server: 'plangent', tool: 'submit_plan', arguments: {...} }
  const mcp = input as { server?: unknown; tool?: unknown } | undefined;
  if (mcp?.server === 'plangent' && typeof mcp.tool === 'string' && mcp.tool in plangentTools) return true;
  if ((tool.kind ?? 'other') !== 'other' || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (title !== JSON.stringify(input)) return false;
  if ('title' in input && 'description' in input &&
    Object.keys(input).every(key => key in plangentTools.save_section.fields)) return true;
  if ('steps' in input && 'kind' in input && 'text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_plan_remark.fields)) return true;
  if ('scope' in input && 'kind' in input && 'text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_task_remark.fields)) return true;
  // A remark on the whole MR leaves out path, line and side.
  if ('text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_review_remark.fields)) return true;
  return signatures.includes(Object.keys(input).sort().join(','));
}
