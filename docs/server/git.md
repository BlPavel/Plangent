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

Closing a work (`core/work/actions.ts`) removes its workspace and always keeps the branch with
every commit, pushed or not. Only uncommitted files (changed tracked files and new files git
would commit) need an explicit `discard`; git-ignored files go with the folder unreported.
`GET .../tasks/:taskId/close-check` lists both for the developer's single confirmation.

Finishing (`finish/`) treats a failed step as a state the developer can leave, never a dead end:

- Git or a repository hook rejecting an agent's commit returns the hook output to the agent
  (`MAX_HOOK_ATTEMPTS` tries, then it must stop). The run stays `running` between tries; after the last one it is
  parked at `confirmation` with status `error`, the proposal kept (commits made so far with their SHA, the rest
  without) so the developer can edit titles and save, ask the agent again (no note needed after a failure),
  or commit without hooks (`skipHooks` on `PUT .../commits`: the developer only, an agent's call ignores it).
- A hook that rewrites working files after a commit stops the run with `hook_changes`; `adopt-hook-changes`
  takes the commits back, adds the rewritten files to the list and the developer saves again.
- `cancel` closes a run without touching Git (it works whatever state the folder is in; `reset` also takes back
  the commits). `rollback` and `cancel` only need HEAD and the branch to be the run's, not the files: moving
  HEAD never changes files. Reassembling commits still requires the reviewed files.
- A task's run that completes closes its work after the repository lock is released, as the manual close does
  (`work.closeWork`, injected from the composition root). If closing fails, the work stays open with a notification.
- A refused request (stale state, validation) never overwrites the stored cause of a failure.
- A committer turn that ends in `commits` without a result marks the run `error`.
- A run whose task or working folder is gone (`task_id` empty while `options.task_id` is set, or a removed
  workspace) is not active: it blocks nothing, the next start and the next application start cancel it.
  Deleting a task first detaches its working folders from finish runs (`tasks` repository).
- New working folders receive the git-ignored files of the project's hooks folder (`core.hooksPath` inside the
  project, e.g. husky's `_`) from the main folder (`copyHookSupportFiles`), whatever tool generated them;
  tracked hook scripts stay as the branch has them.

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
