<!-- plangent:main:start -->
# Plangent: documentation for implementation

When implementing or changing code, rely on the project documentation in `docs/`. Read the relevant documents before editing and follow them. If the code and the documentation disagree, tell the developer instead of silently choosing one.

## Server work

For changes in `server/`, start with `docs/server/ARCHITECTURE.md` (layers and dependency boundaries), then read the documents for the area you touch:

- `docs/server/database.md` — database and SQL
- `docs/server/agents.md` — agents
- `docs/server/mcp.md` — session-scoped agent tools
- `docs/server/review.md` — review
- `docs/server/git.md` — git
- `docs/server/integrations.md` — integrations and documentation sources
- `docs/server/testing.md` — tests

## Client work

For changes in the client, start with `docs/client/ARCHITECTURE.md` (module layout and boundaries), then read the documents for the area you touch:

- `docs/client/api.md` — client API layer
- `docs/client/drafts.md` — drafts
- `docs/client/ui-components.md` — shared UI components
- `docs/client/ui-tokens.md` — UI tokens

## Shared

When a change touches the client–server boundary (endpoints, entities, socket events, errors, Electron bridge), also follow `docs/CONTRACTS.md`.

Do not use `docs/CONNECTIONS-USER-GUIDE.md`: it is a guide for end users of the application, not for implementation.

Read only the documents that match the task; a server-only task does not need the client documents, and vice versa.
<!-- plangent:main:end -->
