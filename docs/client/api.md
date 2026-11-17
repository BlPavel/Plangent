# Client API

Every feature owns server calls in `api.ts`. Bind endpoint keys from the common
contract there; components and stores call the feature API. This keeps request
paths and transport details out of screens.

The library text editor uses `GET /api/library/instruction-text` with `type`,
`scope` and, for project scope, `projectId`. The response contains effective,
own, inherited and built-in text; clients do not resolve inheritance with list
and content requests. See [library state and mutations](../server/library.md).

```ts
// features/projects/api.ts
import { endpoint } from '@core/api/endpoint'
export const gitSettings = endpoint('GET /api/projects/:id/git-settings')
// consumer: await gitSettings({ params: { id: projectId } })
```

Reuse another domain's endpoint through that feature's `index.ts`. Common
request/response types come from `@contracts` using `import type`; keep client
view state locally. See [contracts](../CONTRACTS.md) when adding a server endpoint.

`core/api` provides HTTP, errors, streams, cancellation and workspace scoping;
`core/api/events` provides socket transport. Domain subscriptions belong in the
owning feature's `events.ts` and must unsubscribe when their consumer stops.
Preserve AbortSignal and structured errors when wrapping requests.
While the server does not answer at all (a network failure or the dev proxy's bodiless 5xx, e.g. during a
`tsx watch` restart), GET requests retry with backoff for up to 30 s; other methods are never repeated and fail
at once with `unreachable: true` and «Сервер недоступен». The socket reconnects and announces `events:connected`. Low-level
`api`, `workspaceApi` and endpoint bindings are used only in feature `api.ts`
(their implementation is internal to core transport).

Chat hosts pass the work's `workspaceId` through `ChatView` / `NewChatPanel` to
`ChatComposer`. Mention search sends it as `workspace` to
`GET /api/projects/:id/mentions`; omitting it explicitly means the main project
folder, independent of the global viewing selection. An optional `path` query
resolves one existing file or directory safely in the same folder instead of
running fuzzy search. Reference searches by `key/…` keep their own roots.

`npm run lint` enforces the transport boundary and type-only contract imports;
`npm run typecheck` checks request/response shapes, `npm run check:routes` compares
server registrations, and `npm run test:ui-primitives` tests transport behavior.
