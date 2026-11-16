# Server reviews

`core/review/kernel/` supplies shared threads, messages, batches, reply kinds
and brief building. Domain workflows retain ownership checks, state transitions
and persistence; consumers use each module's public API.

- `review/code/`: developer code discussions, task verification and imported
  colleagues' MR discussions. Task reviewers report structured findings.
- `review/plan/`: plan, architecture and QA rounds. Developers decide reviewer
  cards before dispatch to the matching author. Plan/material saves remap
  references, mark outdated findings and record applied cards. Preserve history.
- `review/branch/`: colleagues' merge requests, private worktrees, threads,
  questions and publication through the code host.

Code can launch a read-only agent review without a task through
`review/code/agent-review.ts`. The `worktree` range compares HEAD with the working
tree (including staged, unstaged and untracked files); `branch` compares the
merge-base with an exact local/remote branch against the same working tree.
Preview only reads Git. Launch pins the base, a snapshot tree and per-file diffs
in session metadata and creates a round even before any findings exist.
The launch may carry free-text `context` from the developer; the brief returns it as `developer_context`.
The existing `task-reviewer` role and its three MCP review tools dispatch by
`metadata.code_review`; task review context and queue behavior remain task-owned.
A task review launched by hand (`launchIndependentReview`) takes a range: `task` (default, everything since
the work's base commit), `worktree` (uncommitted changes against HEAD) or `branch` (merge-base with a ref, plus
uncommitted), an agent/model/effort and free-text `context` (brief: `developer_context`). The agent is the explicit
pick, else the review agent chosen when the work was created (`tasks.review_agent`; older errands keep it in their
session's metadata; also used by the automatic review), else the project's review agent from the settings. The task brief always carries
`developer_requests`: the developer's own messages to the errand/task/executor chats, the statement the reviewer
checks against. A range with no changes does not start.
An errand is completed explicitly through `complete_step`; ordinary replies, discussions, clarification
questions and progress reports leave it in progress. After that tool's turn finishes without cancellation or
error, the errand sets `work_done` in its session's metadata and, with `auto_review`, starts one automatic review.
Later turns are follow-ups and launch nothing. A task with a plan gets
the same review (`core/work/plan-tasks.ts`) after its queue first finishes without failures; it runs only while the
task has no review yet. The queue itself carries no automatic review stage. Both kinds choose their branch at
creation (`POST /api/projects/:projectId/errands`, `.../plan-tasks`) through `core/work/place.ts`. An errand chooses
its review then too; a task chooses it (`auto_review`, `review_agent`) when its queue starts (`.../queue/start`). The same mark (or, for a plan, any filled plan)
gives the work's state `canCheck`, which opens Проверка; it stays closed only while a queue runs.
A plan with open steps keeps the work's stage in Выполнение however many queues have run.
Remarks of a task go to its follow-up agent (`task-chat`, `core/work/task-chat.ts`): the newest one takes every round;
none yet, the first «Отправить» creates it from the agent of the task's latest executor (else the project's agent), with no pick on the card.
`POST .../tasks/:taskId/chat` with `replace` starts a new one (agent, model, effort optional) when the old is idle; the old chat stays as a journal.
An errand has no such replacement: it picks its agent at «изменить» or changes it in its chat (`switchAgent`).
Developers may edit draft code review findings, including agent findings linked to a round; editing preserves their author and round. Sent and processed items cannot be edited.
Findings belong to the pinned review/round. Changed HEAD/branch or stale line
content rejects findings; a turn ending without submission is an interrupted
review, not a successful empty report. History includes reports with no findings.
The Review tab opens colleagues' MRs only; manual branch-pair entry, listing,
fetch and open endpoints have been removed. MR workflows still share the branch
comparison and worktree infrastructure.

MR worktrees install current project/group library main sections, skills and commands before
opening an idle agent thread, including reused threads. Local instruction files and skill/command
directories are copied only from active agents' layout profiles; global agent folders are left
to the adapters. No dependency setup, environment files or other workspace copy patterns run.
Changed instructions restart the idle agent context while retaining its conversation history so
its skill catalog is rediscovered. Busy threads prevent refreshing their shared worktree.
A sidecar records original and installed instruction files: refresh removes the previous overlay,
and finishing restores the pinned files before ordinary Git worktree removal. External changes
to installed instructions block overwrite/removal. Code and the reviewed Git range stay pinned.

Branch review remarks stay drafts until the developer publishes them. A rejected remark
is kept (`rejected`) and never published. A conversation about a remark or a colleague's
thread is a question thread linked by `remark_id` / `thread_id`: its messages queue and go
to the agent in one batch; the agent may rewrite a discussed remark with
`revise_review_remark`, and the first text stays in `original`.

Compose review protocols, library instructions and task-specific briefs per
workflow. MCP access is scoped to the review and delivered batch. Failed
dispatch retains unsent work. Domain services check queue conflicts,
cancellation and target/recipient matching.

Repositories live in `infrastructure/db/repositories/review/`.
`server/tests/review/` covers transitions, ownership, material coverage and
publication. Run `npm test`; see [MCP](mcp.md) and [Git](git.md).

Code review items can be closed before dispatch, while queued, or while the agent is working.
Closing preserves queued replies but excludes the item from future batches. A late agent reply
is recorded without reopening the item. Explicitly adding a developer reply reopens the discussion.

A draft of the review agent (not outdated) accepts a developer reply before it is sent, like a branch review remark
accepts a discussion: the reply queues, the item becomes a question and the next batch carries the thread. An
`implement` reply is not allowed on a draft; the developer's own drafts are still edited, not replied to.

An implement reply from the developer converts a code review question into a fix item in the
same transaction as saving the reply. Ordinary discussion replies preserve the question kind.

Successfully finishing a code review immediately closes the agent processes referenced by its
rounds, including earlier agents, and awaits shutdown before returning. Review and chat history
remain stored. Validation failures leave the agents running.
