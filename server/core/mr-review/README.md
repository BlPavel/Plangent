# MR review

Sessions store a manually loaded MR snapshot, its versions, diff, discussions, local drafts,
and viewed files. No background synchronization. The tab loads review requests on entry and
offers explicit search and refresh. Group routes only access member repositories.

Remarks come from the developer's text. Publication requires explicit confirmation and is
serialized per review. Every confirmed remote draft ID and successful publication is persisted.
A definite partial failure leaves remaining notes editable and retryable. An ambiguous write
(network failure or interrupted process) requires checking GitLab before marking it sent or
returning it to drafts, preventing an automatic duplicate.

Draft positions stay attached to their original SHA. Publication rejects changed heads.
Refresh keeps the previous snapshot and invalidates viewed marks for changed diffs.
Replies and approvals are direct user actions. Agent conversations and worktrees are a separate
later step and are not involved in publishing review notes.

Validation: `npm test`, `npm run test:mr-review-ui`, `npm run typecheck`.
The HTTP tests use a local GitLab simulator and an isolated database; a real self-hosted
installation still requires the developer's PAT and a test MR.
