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
