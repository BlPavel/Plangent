# Configured documentation sources

This module implements a service-neutral JSON API engine with copied source
presets, project HTTP routes and Vue configuration/sync controls. See
[the developer guide](../../../docs/INTEGRATIONS.md) for API and lifecycle details.

## Public interface

Import from `server/core/docs-sources`:

- `validateConfig(value)` validates and copies serializable source settings.
- `createDocsSource(connectionId, settings)` uses the authenticated integration
  HTTP client. The source never receives credentials, sessions or passwords.
- `DocsSource.resolveLink(idOrUrl, signal)` resolves a stable id or configured
  link. Title lookup must return exactly one match.
- `DocsSource.listChildren(id, signal)` loads all pages of immediate children.
- `DocsSource.probe(idOrUrl, signal)` returns requested URLs, extracted fields,
  missing JSON paths, conversion preview and warnings. It writes no files.
- `syncSource(source, folder, selection, options)` is the standalone engine with
  an injectable transport, suitable for tests.
- `syncDocsSource(projectId, options)` uses stored `docs_config`, `docs_selection`
  and `connection_id`, writes under `data/sources/<id>/` and persists sync status,
  timestamp, statistics and diagnostic messages in the existing project table.
- cancelDocsSync(projectId) aborts a job and waits for completion.
- resetInterruptedDocsSyncs() resets stale running rows at server startup.

`DocsSourceConfig` and all result/progress types are in `types.ts`. JSON paths use
 dot-separated own properties, including numeric array indices; `$` or an empty
path selects the whole response. Configure `document_path` and `metadata_path`
when responses wrap the document. The id and title fields are required; a body
is required only for a document download.

## Example settings for an invented API

```json
{
  "document_endpoint": "/manuals/{id}/text",
  "metadata_endpoint": "/manuals/{id}/meta",
  "document_path": "payload",
  "metadata_path": "payload",
  "children": {
    "endpoint": "/manuals/{id}/branches",
    "items_path": "payload.nodes",
    "pagination": {
      "mode": "offset", "limit": 100,
      "offset_parameter": "from", "limit_parameter": "count",
      "total_path": "payload.total"
    }
  },
  "lookup": {
    "endpoint": "/find?name={title}&area={scope}", "items_path": "hits"
  },
  "fields": {
    "id": "key", "title": "label", "body": "text.html",
    "version": "revision", "parent": "up", "url": "href", "updated": "edited"
  },
  "original_url": "/read/{id}",
  "link_patterns": [
    { "pattern": "/read/([^/?#]+)", "id_group": 1 },
    { "pattern": "/area/([^/]+)/([^?#]+)", "scope_group": 1, "title_group": 2 }
  ],
  "body_format": "html",
  "conversion_rules": [
    { "selector": "widget[kind=code]", "action": "code",
      "content": { "selector": "raw" }, "parameter": { "attribute": "lang" } },
    { "selector": "widget[kind=note]", "action": "callout", "label": "Note" },
    { "selector": "widget[kind=expand]", "action": "unwrap",
      "content": { "selector": "section" } },
    { "selector": "widget[kind=nav]", "action": "skip" },
    { "selector": "widget", "action": "unknown", "parameter": { "attribute": "kind" } }
  ]
}
```

Endpoint parameters are URL-encoded. Endpoints and pagination stay on the
connection's service origin. Next-link pagination uses
`{ "mode": "next", "next_path": "links.next" }`; absence, null or an empty next
link ends traversal. Relative next links resolve against the previous request.
Offset pagination ends at the declared total, a short page or an empty page.
Cycles and excessive traversal produce an error instead of pruning documents.
Without a children endpoint, subtree selection becomes document-only and the
engine reports a warning. Optional `ancestors` can select an array of stable ids
or objects containing the configured id field.

Conversion uses Turndown and LinkeDOM. Rules are ordered: the first matching rule
wins. `content` selects the body, `parameter` selects a label or code language;
`attribute` reads an attribute instead of text. Actions are `code`, `callout`,
`unwrap`, `skip`, `unknown`. Common headings, lists, links, images, code and tables
are preserved. Images remain URLs. Internal link patterns default to
`link_patterns`; configured ids selected for sync become relative file links,
including anchors, and other links become absolute URLs. Markdown input rewrites
inline and reference destinations outside fenced code blocks.

## Sync and file behavior

Selection is an array of `{ id, include_descendants, excluded_ids? }` rules.
Overlapping roots are deduplicated; excluded branches are pruned globally.
After discovery, versions are compared with the manifest. More than 500 bodies
requiring download throws `ConfirmationRequired` before downloads or writes.
`confirmed_large: true` resumes the saved discovery without another remote tree
walk. Plans expire after 10 minutes and are invalidated by selection, settings
or manifest changes; an expired plan requires a fresh unconfirmed sync.
`onProgress` reports discovery, downloads and completion. `signal` cancels work.
One sync is allowed per source; downloads use 2–4 workers (default 3).
429, 5xx and transport failures get up to three retries, respecting Retry-After
with a bounded delay. Authentication/permission errors are not retried by the
source engine.

A metadata endpoint with a version field permits an unchanged sync without body
requests. Without metadata, checking each selected root requires a full document
request. Without a version, bodies are downloaded and compared by SHA-256 with a
warning. If metadata omits a configured version, that document also uses hashing.

Each document has YAML front matter with title, id, original URL, version, update
date, space and author. Transliteration, bounded segments and a stable id hash
avoid forbidden names, truncation and case collisions. Parents with selected
children use `<slug-id-hash>/document.md`; leaves use `<slug-id-hash>.md`.
`document.md` avoids the Windows collision between `index.md` and `INDEX.md`.
Root and nested `INDEX.md` files list documents, short excerpts, versions and
child counts. Agents can read these files offline.

`.manifest.json` stores metadata, versions, hashes, paths and cached original
bodies. Cached bodies let a rename, moved parent or newly selected link repair
Markdown without reloading unchanged remote bodies. It contains documentation,
not authentication data. Invalid manifests stop sync to protect existing files.
Managed file operations reject traversal and symlinks.

Discovery and downloads finish before publication. Cancellation or a failed
discovery leaves the previous files and manifest untouched. A failed individual
download retains its previous entry and allows other documents to complete;
new documents that fail are omitted and reported. Each file and the manifest are
written using temporary files plus rename. Obsolete files are removed only after
publishing the manifest. Publication is atomic per file, not a transaction across
all files: a process or disk failure during publication can leave a mixture of
complete old/new files; the next sync repairs it from the last valid manifest.
