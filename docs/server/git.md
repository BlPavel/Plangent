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
`core/workspaces/` owns task working folders. Creating a workspace only adds the worktree
(status `ready`, `setup_done = 0`) so chat and reading start at once; the slow setup waits until
work really starts: `ensureWorkspaceSetup` runs in the background at queue start, when an errand is
created and when a previously prepared workspace is reopened or recreated. The folder stays `ready`
meanwhile; a failure is only stored in `error`. Reading and editing never wait; `run_command` awaits it. Setup copies configured files,
hard-links dependency folders (`workspace_link_dirs`) from the main folder (native
builds, package-manager state and caches are copied or skipped, other disks fall
back to copying) and runs the setup command. Each active workspace of a project
gets a `port_slot`; `workspaceEnv` shifts `workspace_ports` by slot × 10 for its
terminals, setup command and agents.

Agents never run writing Git commands in a shell. Plangent checks roles,
project scope and workflow state. Chat `git_action` requires the turn's Git
permission; private MR reviews and source projects cannot use it.

`core/work/branch.ts` changes a task's existing workspace branch through
`POST /api/projects/:projectId/tasks/:taskId/switch-branch`. The queue and agents
must be stopped, the worktree must be clean, and the branch must be free in
other tasks and worktrees. A new branch starts at the selected base branch,
or the current workspace branch when the base is omitted.
The workspace identity, folder, base branch and task baseline are preserved;
old branches and their commits remain. Task and workspace branch names are
saved in one transaction and published through their existing update events.
Git progress, cancellation and finish locks use the common Git operation path.

`server/tests/git/` covers actions, concurrency, conflicts, commit rules,
merge requests and finishing with isolated repositories.
See [integrations](integrations.md) for connections and [testing](testing.md).
