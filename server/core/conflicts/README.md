# Conflict resolution
The developer runs merge, rebase, cherry-pick or revert themselves (terminal, IDE). Plangent only notices the
stopped operation (`gitOperation` in core/code/git.ts reads MERGE_HEAD, rebase-merge/, rebase-apply/,
CHERRY_PICK_HEAD, REVERT_HEAD) and offers an agent that edits the conflicted files. Staging, `--continue`,
`--abort` and the merge commit stay with the developer.

While an operation is in progress, git-write refuses commit, switch, branch, pull, pull --rebase, push and the
finish reset (`operation_in_progress`); finish does not start. Stage/unstage and fetch still work: staging a
conflicted file is how the developer accepts it.

HTTP: /api/projects/:projectId/conflicts (local origin only).

| Method | Path | Behavior |
| --- | --- | --- |
| GET | / | { operation, files: [{ path, code, conflicted, note }], session, summary } for the current stop |
| POST | /resolve | { note? } one agent turn over the current conflicts and the unsent answers |
| PUT | /answer | { path, text } the developer's reply to the agent's note on a file; sent with the next /resolve |
| POST | /stop | cancel the agent's turn |

One resolution (agent session) per operation: a rebase keeps it across its stops; notes are stored per stop
(the commit being applied). When the operation ends or another begins, the next read closes the resolution and
its session. The agent comes from `conflict_agent_*` in git settings (project → group → global), else the git agent,
else the project's default agent.

The `conflict-resolver` role gets get_conflicts, report_conflict_file (resolved — no markers left; question; recommend)
and finish_conflicts. Permissions: read tools and read-only git are allowed; edits only of the conflicted files
captured at /resolve (session metadata conflict_paths); deletes, moves and any other command are denied, so the
agent never asks the developer. It does not run installs or builds; it says what to run.
Events: conflicts:changed { projectId }.
