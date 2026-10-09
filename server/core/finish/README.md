# Finish workflow
HTTP: /api/projects/:projectId/finish (local origin only).
POST / starts with scenario commits|push|full, optional task_id, targetBranch, branchName,
includeDescription (inherited by default), includeCoauthors (false by default), human coauthors.
nothing returns null without storing a run. full requires targetBranch and a resolvable code-host connection.
Branch creation is explicit via branchName; the original HEAD remains the reset base.

Stages: branch → commits → confirmation → push → mr → done (commits stops after confirmation; mr only for full).
MR stage: after push the committer session is prompted with the template; it calls create_merge_request(title, description)
(allowed only at stage mr). Target branch, reviewers, labels, remove-branch and squash come from the run and project MR defaults;
creation goes through task-mr create (push check, existing-MR reuse, task mr_link). No extra confirmation. mr_url is stored and
sent in finish:notification. Error at mr: POST /:id/accept retries.
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
