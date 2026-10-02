
# Integrations and documentation sources: developer guide

The backend separates authenticated connections from documentation sources.
Provider names, paths and markup belong to preset data; the HTTP client and
source engine operate on configuration. Agents receive local Markdown paths
through the existing source catalog and @key mentions, never credentials.

## Modules and dependencies

- server/models/integrations.ts: provider-neutral read contracts.
- server/core/integrations: organizations, accounts, connections, login
  strategies, encrypted sessions and account revision invalidation.
- server/infrastructure/secrets: SecretVault implementations. Core integrations
  receive the configured vault; they never import Electron.
- server/infrastructure/http/integration-client.ts: authenticated same-origin
  transport, bounded redirects, timeout, cookie isolation, error translation.
- server/core/docs-sources: source configuration, link resolution, JSON
  extraction, traversal, conversion and incremental publication.
- server/core/projects: validation and managed docs-source lifecycle.
- client settings/ConnectionsSettings.vue: organization, account and connection
  forms; passwords use a separate write-only dialog.
- client projects/DocsSourceFields.vue, DocsTree.vue, SourceView.vue: source
  settings, diagnostics, lazy trees, exclusions and sync controls.
- client projects store: WebSocket status/progress subscription survives closing
  a source view.

Presets are copied into saved settings. Changing a shipped preset does not
silently change existing connections or sources. A service root is an HTTP(S)
origin, including port; paths to login, documents and metadata are relative to
that origin. For a server installed under a context path, add that prefix to
every configured endpoint and original_url. The UI displays normalized roots
and resolved request URLs.

## API

All routes below are under /api. Integration/project management rejects
non-loopback Host values and foreign browser Origins. Requests without Origin
remain available to local tools. The development renderer at a loopback
http://localhost:5173 or http://127.0.0.1:5173 is also allowed; production
renderers use the backend origin.

- GET /integrations/presets and /integrations/storage.
- GET/POST /integrations/organizations, /credentials, /connections.
- GET/PATCH/DELETE /integrations/{collection}/{id}.
- PUT /integrations/credentials/{id}/password and
  /integrations/connections/{id}/password for a connection's own account.
- GET /integrations/connections/{id}/credential returns the effective public
  account; POST /integrations/connections/{id}/check returns status, message,
  resolved URL and configured user name.
- POST /integrations/normalize-url returns the service origin.
- POST /projects accepts kind=source, source_type=docs, connection_id,
  docs_config and docs_selection; no repo_path is needed. PATCH /projects/{id}
  updates configuration, selection and normal source availability.
- GET /projects/{id}/docs/presets returns source templates.
- POST /projects/{id}/docs/resolve with { input } resolves a link or id.
- GET /projects/{id}/docs/children?id=... loads all immediate children.
- POST /projects/{id}/docs/probe with { input } returns request URLs, extracted
  fields, missing paths, a Markdown preview and capability warnings.
- Resolve, probe and POST children also accept { connection_id, config }
  to diagnose unsaved settings using /projects/draft/docs/... .
  POST children takes { id }.
- POST /projects/{id}/docs/sync returns 202 immediately; duplicate runs return
  409. { confirmed_large: true } resumes a pending plan above 500 downloads
  without rediscovery. Plans expire after 10 minutes or settings/manifest changes.
- POST /projects/{id}/docs/cancel aborts and waits for the job to settle.
- DELETE /projects/{id} cancels a job before deleting the owned source folder.

Docs selections are { id, include_descendants, excluded_ids? } arrays.
Selection changes are rejected during a run. Source type cannot be changed
after creation. Docs repo_path is always computed under DATA_DIR/sources/{id},
ignoring arbitrary client paths. Folder sources retain their existing behavior.

WebSocket /ws/events emits docs-sync-progress with project_id and progress
(stage, found, downloaded, processed, total); total counts bodies requiring download, and docs-sync-status with project_id and
either status=running or the final public project. Final status/statistics are
stored in SQLite. A plan above 500 downloads sets sync_stats.code=confirmation_required
and confirmation_count; the UI asks the user before retrying. A server restart
resets stale running rows to cancelled. File search caches are invalidated on
completion. Closing a view does not cancel a server job.

## Add a connection template

Add a typed data entry to server/core/integrations/presets.ts. Supply
auth_strategy and auth_config; do not add a provider branch to the engine.

AuthConfig supports:
- check_path and optional user_path for identity verification.
- expect_json to detect HTML login pages; timeout_ms for bounded requests.
- login_path, username_field, password_field for form authentication.
- fields and headers for public constants only.
- strategies as an ordered basic/form list for auto.
- invalid_password and invalid_session rules using statuses, header
  name/value, redirect_path (with * wildcards), or html_instead_of_json.

A bare 401 from Basic during auto with a form fallback means Basic may be
disabled; the form strategy gets its turn. A configured invalid-password rule
(such as a definite rejection header) still stops immediately. Standalone Basic
and a form credential rejection mark the account invalid.
A definite invalid password stops fallback, marks only that account
needs_update and invalidates dependent sessions. Network failures and access
denials do not mark a password invalid. Unsupported SSO does not silently
launch a browser. token/browser/api-login are reserved, not implemented.

The built-in Atlassian Server/DC template tries basic then form, uses
/dologin.action and checks /rest/api/user/current. It is meant for ordinary
Server/DC form login, not Cloud or SSO. The current-user path is for Confluence;
for Jira change it and the configured user field. API capabilities can vary by
server version and administrator configuration. Reference:
https://developer.atlassian.com/server/confluence/rest/latest/

## Add a documentation template

Add a typed data entry to server/core/docs-sources/presets.ts. DocsSourceConfig
supports document/metadata endpoints, dot-separated fields, link regexes with
capture indices, original_url, optional children/title lookup with offset/next
pagination, html/markdown bodies and ordered conversion rules. Consult
server/core/docs-sources/README.md for the complete invented-service example
and publication guarantees. Use fixtures to test the template through the
generic authenticated transport, not a provider-specific downloader.

The built-in Confluence Server/DC template requests storage HTML, versions,
ancestors and space metadata; paginates children using start/limit; resolves
pageId, /spaces/.../pages/id and /display/space/title links. Title lookup must
resolve exactly one stable id. Code macros become fences with a language;
callouts become quotes, expand retains content and navigation macros are
skipped. Unknown macros are labeled. Reference:
https://support.atlassian.com/confluence/kb/how-to-get-page-content-or-child-list-via-rest-api/

For an API without a children endpoint the UI and engine expose document-only
selection with a warning. Without versions the engine compares body hashes;
without metadata it requests full root documents to check for changes.

## Secrets, paths and platform constraints

Passwords and session cookies are encrypted before SQLite writes and never
appear in public account models, progress or manifests. HTTP errors expose
controlled messages rather than remote bodies or request options. Debug
diagnostics must use redact(); do not print transport headers or form bodies.
The only accepted token header sentinel is the public value no-check.

Production Electron injects SafeStorageVault after app.whenReady() and sets a
writable userData cwd before importing the backend. On Windows/macOS safeStorage
uses the platform's encryption. An unavailable backend or basic_text is refused;
there is no silent plaintext fallback. Development uses an AES-GCM key file
beside the database (not a production protection boundary); in-memory vaults
serve tests. Ciphertexts from another vault/user/machine require replacing the
password. Secret storage availability is exposed to the UI.

Local Markdown paths use bounded, transliterated segments and stable id hashes.
Generated links use POSIX separators; filesystem operations use node:path.
Case collisions, reserved Windows names, traversal and symlink/junction
ancestors are guarded. Deletion validates the owned root and never removes a
user-selected repository. Individual file publication is atomic, not a
transaction across all source files. A failed or cancelled discovery preserves
the previous snapshot; per-document failures retain the previous document.

## Verification without changing native ABI

npm test includes integrations, documentation sources, vault and database
migration tests by default. It does not rebuild better-sqlite3. Use:

    npm run typecheck
    npm run lint
    npm test
    npm run test:integrations-ui
    npm run build
    npx tsc -p tsconfig.electron.json

The UI test uses the existing Vue compiler, esbuild and LinkeDOM in memory;
no browser download or additional package is required. It covers preset
application, normalization, separate password writes, probe, subtree/exclusion
selection and WebSocket progress display.

Native modules must already match the system Node ABI. Do not run
electron:build or electron:release merely to validate TypeScript: those commands
rebuild native modules for Electron. If existing file-watcher tests keep the
Node 22 runner alive, run the same test globs with --test-force-exit; this exits
after test completion, not before. Existing cleanup tests can intermittently
report EBUSY on Windows, so distinguish cleanup failures from assertions.

Current verification was performed on Windows with mocked safeStorage
availability/foreign ciphertext tests and platform-neutral path assertions.
A native macOS desktop run and packaged OS keychain checks require a macOS
machine and remain part of release smoke testing; a Windows build cannot prove
those OS facilities work on a particular Mac.

## User instructions

See [the Russian user guide](CONNECTIONS-USER-GUIDE.md) for setup, manual configuration and troubleshooting. The UI embeds this same document; keep it aligned with connection-hints.ts and docs-hints.ts.
