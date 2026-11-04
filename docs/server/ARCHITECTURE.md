# Server architecture

The server in `server/` uses a pragmatic modular monolith layout:

```text
server/
  models/
  core/
    agents/
    library/
    orchestration/
    projects/
    runs/
    sessions/
    shared/
    tasks/
  infrastructure/
    adapters/
    db/
    http/
      routes/
    terminal/
  index.ts
```

`models` re-exports the common contract and keeps server-only types and interfaces.
It does not import from `core` or `infrastructure`.

`core` contains domain behavior grouped by product area. Domain modules are
transport-agnostic and own their thin repository functions. They may use shared
core services and model types. Repository modules use the shared database
connection directly by choice; there are no repository interfaces or DI
containers.

`infrastructure` contains delivery and external runtime code: Express routes and
server assembly in `infrastructure/http`, SQLite schema/connection setup in
`infrastructure/db`, PTY/tmux integration in `infrastructure/terminal`, and
agent CLI adapters in `infrastructure/adapters`.

Dependency direction is one-way at the module boundary: infrastructure calls
core, and core points toward models. Core code must not import HTTP routes,
terminal sessions, or CLI adapters; runtime integrations are wired from
`server/index.ts`.

Integrations, authenticated documentation sources and their lifecycle are documented in [INTEGRATIONS.md](../INTEGRATIONS.md).

Shared entities, HTTP endpoints, socket events and platform types are declared in
[`contracts/`](../../contracts/index.d.ts). `server/models` re-exports those types
and retains server-only types locally. The declaration files have no runtime code.

Register HTTP routes only through `typedRoutes` in
`server/infrastructure/http/typed-route.ts`. Supply the full contract endpoint key
and use the matching `json`, `empty`, `file` or `stream` helper. The helper types
request params/query/body and responses and forwards asynchronous errors to Express.
Handlers still validate incoming data at runtime. `npm run check:routes` compares
every registration with the contract; `npm run typecheck` checks their types.
See [CONTRACTS.md](../CONTRACTS.md) for the endpoint workflow.

Git integration domains in `server/core`: `code` (read-only `git.ts`; writes in `git-write.ts`; commit message rules in
`commit-message.ts`), `code-reviews` (the developer's review with the agent, plus colleagues' MR discussions pulled by
button), `finish` (the «Завершение работ» workflow and the `committer` MCP role), `code-hosts` (`CodeHost`, GitLab),
`mr-review` (review of other people's MRs), `task-mr` (create MR for a branch/task). Each has a README.
Agents never run writing git commands in a shell; commits, push and MR are Plangent MCP tools checked by the server.
