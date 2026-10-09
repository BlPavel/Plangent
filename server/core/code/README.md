# Read-only code service

HTTP prefix: /api/projects/:projectId/code. Uses the registered project root and local-origin guard.
All paths are project-relative; containment includes existing symlink ancestors. Git internals are excluded.
The /code endpoints do not write files, change branches, stage files or create commits.
Write operations live separately in git-write.ts and /api/projects/:projectId/git.

GET endpoints:
- /repository: RepositoryInfo or null for a non-repository.
- /changes: GitChange[] (empty without Git).
- /files?includeIgnored=false: file paths for client-side quick open.
- /tree?path=&includeIgnored=false: immediate TreeEntry[] children, directories first,
  ignored flag, file status and changed-descendant count.
- /file?path=...: { path, size, kind, content?, mime? }; kind is text/image/binary/too-large.
  Only text has content. Working-file reads are bounded to 1 MiB.
- /image?path=...: image bytes with MIME and sandbox CSP (including SVG).
- /old-file?path=...&base=HEAD: { content } for a Git version.
- /diff?path=...&base=HEAD&end=&originalPath=&ignoreWhitespace=false: { diff }.
- /search?q=...&caseSensitive=false&wholeWord=false&regex=false&mask=:
  application/x-ndjson stream. Each line is either
  { type: "match", path, line, text }, { type: "done", matches, files, truncated },
  or { type: "error", error } if the response has already started.
  Line numbers are 1-based; text excludes CR/LF. Results are matching lines.
  Limits: 2000 matching lines / 200 files. Binary and >1 MiB files are skipped.
  Masks are comma-separated globs with *, ** and ?; a mask without / matches basenames.
  Uses git grep --untracked (PCRE for regex) with literal file paths; Node fallback without Git.
  Closing/cancelling the HTTP request aborts enumeration and kills the Git child.
  Clients should debounce requests (~300 ms), abort previous requests, and render incrementally.

Subscriptions use the existing /ws/events socket. Send
{ type: "code:subscribe", projectId } / { type: "code:unsubscribe", projectId }.
The server replies code:subscribed / code:unsubscribed / code:error.
Changes emit { type: "code:changed", projectId } after a 500 ms debounce.
On subscribe acknowledgement or change, refetch tree, repository/changes and the open file.
Manual refresh uses the same GET requests. Resubscribe on reconnect; closing the socket releases all subscriptions.

Windows/macOS share one recursive native watcher per project root, filtering common generated directories
and Git objects/logs. Git worktrees additionally watch their external Git metadata directory.
Linux watches only HEAD/index (and packed-refs) in the Git metadata directory, without recursive project traversal;
working-file updates there require manual refresh unless accompanied by an index/HEAD update.
Watchers are closed after the last subscriber disconnects.

Git endpoints: GET /repository, /branches; POST /stage and /unstage with paths[], /fetch, /pull (--ff-only), /push (sets origin upstream if missing), /switch with branch, /branch with name/base, /cancel with operationId.
Writes are serialized by canonical repository path. Git write operations reject active agent execution and active finish workflows.
Network/hook output is sent in git:progress events keyed by project_id and operationId (optional client-supplied ID). Disconnect aborts the operation; timeout defaults to 120 seconds. Cancellation terminates the Windows process tree. Authentication failures suggest PAT or SSH.
resetForReassembly is an internal finish-only function and has no route; it requires the expected current HEAD and an ancestor base.

POST /commit-message accepts title, body, includeDescription, includeCoauthors, coauthors[{name,email}]. Returns assembled message, line-based violations and cleaned text. Embedded Co-authored-by lines are stripped regardless of casing; only the explicitly enabled list adds human trailers.
POST /commit takes the same fields and overrideForbidden (explicit boolean). Commit resolves inherited settings again inside the repository queue; forbidden patterns block unless overridden, format mismatch is a warning and does not block. git config provides author/committer; hook output and cancellation follow other operations. POST /generate-message uses a bounded read-only agent session with staged diff, rules and optional taskId; generated attribution is cleaned before returning title/body.

Project Git data: projects.clone_url, host_project_path, connection_id and git_settings. Settings merge field by field from defaults, group and project; false, empty strings and empty arrays override inherited values. GET /api/projects/:id/git-settings returns values and sources. POST /api/projects/git-preview with repo_path inspects origin; a unique matching connection hostname is suggested. Project creation accepts creation_mode=folder|clone and operationId. Clone requires a new leaf under an existing parent; matching unregistered clones return reuse_existing and require explicit reuse_existing=true. POST /api/projects/clone-cancel aborts by operationId. Failed/cancelled clones remove only the newly reserved, identity-checked directory. Git CLI authentication uses the developer's Git configuration, separately from hosting API credentials.

Finish workflow uses /api/projects/:projectId/finish and core/finish (see its README).
Manual operations are blocked while a finish run is active, including its confirmation screen.
Nested git-write calls within a workflow share one repository transaction; a reset/rebuild cannot
interleave with a stage, branch switch or push from a second HTTP request.
GET /git/repository includes busyReason; /git/settings and /git/coauthors feed the client panel.
