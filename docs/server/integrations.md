# Server integrations

`core/integrations/` owns organizations, accounts, connections and authorization
lifecycle. `infrastructure/http-client/` owns authenticated same-origin requests,
bounded redirects, timeouts, cookie isolation and controlled errors.
Public models never contain passwords, tokens or session cookies.

Presets are copied into settings; editing shipped presets does not rewrite
saved connections. Service roots are HTTP(S) origins; endpoints include any
installation context path. Add templates in `core/integrations/presets.ts`
using configuration rather than provider branches.

Basic, form, auto and token authentication share encrypted secret storage.
Auto tries configured strategies; definite password rejection invalidates that
account and dependent sessions. Network/access errors do not invalidate it.
Token auth uses a configured header/prefix and the separate write-only password
endpoint: 401 invalidates the token, 403 does not. Never put secrets in presets,
URLs or public config; redact diagnostics. Management routes enforce local origins.

`infrastructure/secrets/` provides vaults. Electron injects safeStorage after
startup and rejects unavailable/plaintext backends. Development uses a local
AES-GCM key file; tests use in-memory vaults. Foreign ciphertext requires
replacement credentials.

`core/projects/sources/` owns source configuration, selection and sync lifecycle;
`infrastructure/docs-sources/` owns extraction, traversal, conversion and
publication. Add templates in `core/projects/sources/presets.ts`.
Configured endpoints, JSON paths and link patterns support provider-neutral APIs.
Missing children support means document-only selection; missing versions use
body hashes. Probe diagnoses settings without writing files.

Sources publish under `DATA_DIR/sources/<id>/` with stable Markdown paths,
indexes and a manifest. Agents receive local paths through explicit `@key`
references. Reject traversal and symlink ancestors. One job runs per source.
Cancellation/failed discovery preserves the previous snapshot; individual
download failures retain prior documents. Publication is atomic per file,
not across the snapshot. More than 500 downloads requires confirmation;
saved plans expire after ten minutes or settings/manifest changes.
WebSocket progress/status survives closing the view; startup resets interrupted jobs.

`infrastructure/code-hosts/` implements `models/code-host.ts`.
Host selection uses the project's connection, then its group's, then a unique
matching GitLab origin connection. Git CLI authentication is configured separately.

`npm test` covers integrations, sources and vaults;
`npm run test:integrations-ui` covers configuration and progress.
See the [user guide](../CONNECTIONS-USER-GUIDE.md) for setup and troubleshooting.
