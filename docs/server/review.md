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
Findings belong to the pinned review/round. Changed HEAD/branch or stale line
content rejects findings; a turn ending without submission is an interrupted
review, not a successful empty report. History includes reports with no findings.
The Review tab opens colleagues' MRs only; manual branch-pair entry, listing,
fetch and open endpoints have been removed. MR workflows still share the branch
comparison and worktree infrastructure.

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

An implement reply from the developer converts a code review question into a fix item in the
same transaction as saving the reply. Ordinary discussion replies preserve the question kind.

Successfully finishing a code review immediately closes the agent processes referenced by its
rounds, including earlier agents, and awaits shutdown before returning. Review and chat history
remain stored. Validation failures leave the agents running.
