# Client architecture

The Vue client lives in `client/src`. Dependencies flow from `app` through
`features`, `core`, and `shared`:

| Layer | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `app/` | Entry point, App, router assembly, toast and confirm hosts | All client layers |
| `features/<domain>/` | Domain screens, behavior, stores, API and event subscriptions | core, shared, contracts, other features through their public API |
| `core/` | HTTP/WebSocket transport, platform bridge, global app and draft stores | shared, contracts |
| `shared/` | Domain-independent UI, composables and utilities | shared and npm packages |

Import another feature through `@features/<name>` (`index.ts`). Keep internal
imports within the owning feature. A feature exports only what its consumers need.
No lower layer imports `app`; shared also cannot import core or contracts.
Client code never imports `server/`.

`common/library-registry.ts` is runtime policy shared by client and server.
Features may import it directly for library types, sections and labels. It has
no application dependencies; `contracts/` remains declarations only.

Put routed screens in `views/`, embedded components in `components/`, domain
stores in the feature's `stores/`. Global application state belongs in `core/stores`.
The router is assembled in `app/router.ts` from feature route arrays.

Aliases `@core`, `@shared`, `@features`, and `@contracts` are synchronized in
`client/vite.config.ts` and `client/tsconfig.json`. Import common types with
`import type { Task } from '@contracts'`; feature `types.ts` holds client-only types.
See [the common contract](../CONTRACTS.md).

`shared/markdown` owns Markdown rendering, Mermaid, smooth text and document links.
`shared/code-viewer` owns code/diff rendering and text diffs. Domain help, platform
access and server calls belong in their owning feature or core.

Screens which already show code call `core/composables/useCodeScreen` for their
mounted lifetime. The app store counts these screens so the application shell
can decide whether side code is available without inspecting their local tabs.
The shell owns the common work place used by terminal and code.

Code and Git stores accept an instance name (`main` by default). Within code,
owners call `provideCodeStores`; reusable `BaseSwitcher`, `SearchPanel` and
`FileViewer` obtain the owner's stores from `stores/context`, falling back to
the main instance. Each instance owns its subscriptions, requests and lifecycle.

Rules and verification:

- [UI components](ui-components.md): shared primitives and layout boundaries.
- [UI tokens](ui-tokens.md): typography, colors and common visual values.
- [Drafts](drafts.md): retain unsent input and document versions.
- [API](api.md): feature endpoints, transport and domain subscriptions.

`npm run lint` enforces layer boundaries for aliases and relative imports;
`npm run test:ui-consistency` includes regression fixtures for forbidden imports.
