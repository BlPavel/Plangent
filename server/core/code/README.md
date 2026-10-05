# Read-only code service

HTTP prefix: /api/projects/:projectId/code. Uses the registered project root and local-origin guard.
All paths are project-relative; containment includes existing symlink ancestors. Git internals are excluded.
No endpoint writes files, changes branches, stages files or creates commits.

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
