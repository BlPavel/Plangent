# Client API

Every feature owns server calls in `api.ts`. Bind endpoint keys from the common
contract there; components and stores call the feature API. This keeps request
paths and transport details out of screens.

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
Preserve AbortSignal and structured errors when wrapping requests. Low-level
`api`, `workspaceApi` and endpoint bindings are used only in feature `api.ts`
(their implementation is internal to core transport).

`npm run lint` enforces the transport boundary and type-only contract imports;
`npm run typecheck` checks request/response shapes, `npm run check:routes` compares
server registrations, and `npm run test:ui-primitives` tests transport behavior.
