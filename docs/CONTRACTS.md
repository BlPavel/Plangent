# Common contract

`contracts/` contains declaration files only: entities, endpoint maps, socket
events, API errors and the Electron bridge. Keep one file per domain and re-export
types from `index.d.ts`. Runtime code, database details and UI state stay with
their owners. Import using `import type { Task, Endpoints } from '@contracts'`.

Shared executable library policy lives in `common/library-registry.ts`, outside
this declaration-only directory. `library.d.ts` declares instruction editor state
and `GET /api/library/instruction-text`; effective/inherited selection belongs to
the server. `POST /api/library/:id/detach` accepts optional `changes` to save the
project copy in one atomic operation. Existing library and defaults endpoints
remain available.

To add an endpoint:

1. Add its full `METHOD /api/path/:param` key to the domain map and include it in
   `Endpoints`. Define params, query, body, response and kind; streams also define events.
2. Register it through `typedRoutes(router, mount)` from
   `server/api/http/typed-route.ts` in the server route module.
   Use `.json`, `.empty`, `.file` or `.stream` to match the contract kind.
3. Bind the key with `endpoint('METHOD /api/path/:param')` in the owning feature's
   `api.ts`; expose that feature API through its `index.ts` when needed elsewhere.

`server/models` re-exports common types and keeps server-only types locally.
Run `npm run typecheck` for contracts, server, client and Electron, and
`npm run check:routes` to compare registered routes with the contract.
TypeScript types do not validate incoming data at runtime: handlers must still
validate untrusted params, query and bodies.

See [server architecture](server/ARCHITECTURE.md) for layer boundaries and
[MCP](server/mcp.md) for session-scoped agent tools.
