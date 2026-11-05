# Server Git

`core/git/` owns workflows; `infrastructure/git/` executes the Git CLI,
reads/writes repositories, manages worktrees and serializes operations.

- `repo/`: checked actions, task branches, base commits, statistics and review worktrees.
- `commits/`: message validation, cleanup and generation.
- `hosts/`: code host selection through the model interface.
- `merge-requests/`: create/find task merge requests.
- `conflicts/`: conflict resolution workflow.
- `finish/`: commit/push/MR stages and committer sessions.

Routes and MCP tools call core workflows. Preserve repository locks, progress,
cancellation and workspace ownership checks. Provider REST calls belong in
`infrastructure/code-hosts/`, using `infrastructure/http-client/`.
`core/workspaces/` owns task working folders.

Agents never run writing Git commands in a shell. Plangent checks roles,
project scope and workflow state. Chat `git_action` requires the turn's Git
permission; private MR reviews and source projects cannot use it.

`server/tests/git/` covers actions, concurrency, conflicts, commit rules,
merge requests and finishing with isolated repositories.
See [integrations](integrations.md) for connections and [testing](testing.md).
