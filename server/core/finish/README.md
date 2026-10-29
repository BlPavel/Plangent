# Finish workflow
HTTP: /api/projects/:projectId/finish (local origin only).
POST / starts with scenario commits|push|full, optional task_id, targetBranch, branchName,
autoContinue (false by default; the launch form enables it), includeDescription (inherited by default), includeCoauthors (false by default), human coauthors.
nothing returns null without storing a run. full requires targetBranch and a resolvable code-host connection.
Branch creation is explicit via branchName; the original HEAD remains the reset base.

Stages: branch → commits → confirmation → push → mr → done (commits stops after confirmation; mr is a short stage after the push, only for full).
MR (full only): the agent writes the title and description together with the commits (set_merge_request, stored as mr_draft;
finish_commits needs it). The user sees and edits them on the confirmation screen (PUT /:id/merge-request); nothing is pushed or created
before accept, unless autoContinue was selected. Accept pushes, then creates the MR from the confirmed text through task-mr create (push check, existing-MR reuse, task mr_link);
target branch, reviewers, assignees, labels, remove-branch and squash come from the project MR defaults. mr_url is stored and sent in
finish:notification. Error at stage mr (the MR could not be created): POST /:id/accept retries with the same text.
With autoContinue=true, finish_commits validates the commits and MR draft and continues directly to completion or push/MR under the repository lock, without a waiting state. Errors retain the same retry and recovery actions.
Only the user can accept, revise, edit or roll back through HTTP. Rollback requires confirmed=true.
PUT /:id/commits accepts the complete edited list, including file moves, splits and merges.
POST /:id/revise continues the original committer session, including retry after an adapter error. POST /:id/accept pushes without force.
GET /task/:taskId exposes narrow status for the task queue (the «Завершение» stage in the task) and the client panel in the Код tab.

The committer is read-only and receives just get_finish_context, set_commits and finish_commits.
Git mutations run on the server via git-write, never through the agent shell.
Each changed file must occur exactly once. Renames stage their old path alongside the new path.
Generated text is cleaned; explicit human coauthors come only from the enabled options.

A canonical repository queue spans complete multi-command rebuilds and blocks all manual Git writes.
Rebuild/rollback require the workflow branch, last saved SHA and unchanged captured working tree.
Before a reset, origin is fetched and any workflow commit reachable from origin blocks the reset.
Reset is mixed; files are retained. Each successful commit SHA is persisted before continuing,
so hook failures preserve recovery information. Hook output streams as git:progress and is stored;
120-second timeouts and POST /:id/cancel-operation cancel the process tree.
An error retains the repository lock. Restart marks running workflows error; the user can rebuild
or safely roll back before push, or retry an interrupted push. External Git writes require an external client.
Events: finish:changed and finish:notification. The existing code notification bridge calls platform.notify.
