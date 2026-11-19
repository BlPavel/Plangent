# Server architecture

The server in `server/` is a modular monolith. `index.ts` assembles the
application; `core-services.ts` wires callbacks between domains.

`common/library-registry.ts` provides pure executable library policy to both
applications. It imports contract types only and contains no server dependencies.

| Layer | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `api/` | HTTP routes, WebSocket delivery, MCP tools | core, models, contracts |
| `core/<domain>/` | Domain rules and workflows | earlier core public APIs, infrastructure, models |
| `infrastructure/` | Persistence, processes and external services | infrastructure, models |
| `models/` | Server types and contract re-exports | contracts |

Import another core module through its `index.ts`. Runtime dependencies follow
the order in `scripts/eslint-server-layers.mjs`; inject callbacks from the
composition root for collaboration in the opposite direction. Type-only imports
still use public APIs. Core accesses SQL only through its own
`infrastructure/db/repositories/<domain>/`; keep SQL and transactions there.
Infrastructure never imports core or API. No DI container is required.

Core modules:

- `shared/`: domain-independent helpers.
- `files/`: safe paths, reads, trees, search and watchers. `repository-state.ts` shares
  `git ls-files`/`git status` snapshots of the Code screen's reads for roots under a recursive
  watcher (any file event drops them); checks before Git writes call `infrastructure/git` directly.
- `integrations/`: accounts, connections and authorization lifecycle.
- `settings/`: application/git settings, agent choices and level resolution.
- `projects/`: projects, groups, workspace roots, explicit references, remote URLs and documentation `sources/`.
- `library/`: items, levels, synchronization, proposals and built-in texts.
- `agents/`: `catalog/`, `sessions/`, selection, launch, turn waiting and one-shot work.
- `tasks/`: tasks, moves and task files.
- `workspaces/`: task working folders and recovery.
- `git/`: `repo/`, `commits/`, `hosts/`, `merge-requests/`, `conflicts/`, `finish/`.
- `preparation/`: analysis, materials, plans and preparation prompts.
- `execution/`: orchestrator, queue and step context.
- `review/`: shared `kernel/` and `code/`, `plan/`, `branch/` workflows.
- `work/`: errands, task chat, work launch and state.
- `terminals/`: terminal domain lifecycle.

Delivery lives in `api/http/` (including `routes/`, `typed-route.ts` and
`local-origin.ts`), `api/ws/` and `api/mcp/`.
Infrastructure owns `db/` (connection, transactions, ordered `migrations/` and
per-domain `repositories/`), `git/`, `code-hosts/`, `http-client/`, `acp/`,
`docs-sources/`, `secrets/`, `files/`, `agent-proxy/` and `terminal/`.
Integration tests live in `server/tests/<domain>/`; `tests/support/` provides
isolated databases, Git repositories and the mock ACP agent.
Client tests live in `client/tests/`. `scripts/` owns build/runtime setup,
route checking and ESLint boundary rules.

Rules and verification:

- [Database](database.md): migrations and repositories.
- [Agents](agents.md): sessions, permissions and process lifetime.
- [MCP](mcp.md): registry and role authorization.
- [Library](library.md): instructions, skills, shared registry and save operations.
- [Reviews](review.md): shared kernel and domain workflows.
- [Git](git.md): repository operations and finishing work.
- [Integrations](integrations.md): connections, secrets and documentation sources.
- [Testing](testing.md): checks and isolated fixtures.
- [Common contract](../CONTRACTS.md): HTTP types and endpoint registration.

`npm run lint` enforces boundaries; `npm run typecheck` checks types,
`npm run check:routes` checks HTTP registrations, and `npm test` checks behavior.
