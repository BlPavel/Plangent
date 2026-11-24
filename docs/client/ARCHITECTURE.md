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

New-session mode selection in `features/agent-chat` starts at <Автоматически>.
Only an explicit mode pick is sent as a preference; an empty mode lets the server
resolve it from session permissions. Keep the options probe's current mode separate
from the developer's choice. Model and reasoning presets still apply normally.

`features/agent-chat/utils/agent-options.ts` presents the Claude adapter's explicit
DeepSeek Flash, GLM and Kimi Opus/Sonnet mappings as provider models rather than
Claude roles. Aliases of the same model collapse to one choice; distinct provider
models (for example GLM 5.4 and 5.3) remain separate choices. Preserve the
reported wire id for model changes. Apply this to both config options and legacy
model lists, including cached options and existing chats. Other model catalogs
(including agents offering DeepSeek alongside other providers) stay intact.

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

The main code screen and side panel reuse `CodeFileTabs` and the tab operations
in `stores/side-panel`. The store keeps their open files separately (`mainPlaces`
and `places`), keyed by project and workspace, for the lifetime of the application.
Each tab remembers its file/diff mode. Closing all main tabs keeps the screen
empty when revisiting that place; deleting a project or workspace clears both lists.
`CodeFileTabs` handles overflow in both locations: paging arrows, mouse-wheel
scrolling, automatic active-tab reveal, and an open-file menu with full paths.
The menu also holds the close-all action to keep it away from scrolling controls.

Rules and verification:

- [UI components](ui-components.md): shared primitives and layout boundaries.
- [UI tokens](ui-tokens.md): typography, colors and common visual values.
- [Drafts](drafts.md): retain unsent input and document versions.
- [API](api.md): feature endpoints, transport and domain subscriptions.

`npm run lint` enforces layer boundaries for aliases and relative imports;
`npm run test:ui-consistency` includes regression fixtures for forbidden imports.
