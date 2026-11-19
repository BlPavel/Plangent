# Server testing

Run commands from the repository root:

- `npm run lint`: layer boundaries, public imports and SQL placement.
- `npm run typecheck`: contracts, server, client and Electron types.
- `npm run check:routes`: HTTP registrations against contracts.
- `npm test`: server unit/integration tests, including colocated tests.
- `npm run test:client`: client tests in `client/tests/`.
- `npm run build`: server compilation, runtime assets and client build.

`server/tests/<domain>/` holds integration tests; `tests/support/` supplies
isolated databases, temporary Git repositories and a mock ACP agent.
Use these helpers instead of real user data or network accounts. Test observable
behavior, ownership, cancellation and migration compatibility.
Colocated tests cover local policies and the MCP registry.

The test command preloads `server/tests/support/environment.cjs`.
It isolates both the database directory and OS temporary files for every worker,
including command logs, so tests cannot clear logs of the hosting Plangent process.
Native modules must match the Node ABI; tests do not rebuild them.
Electron packaging rebuilds native modules for Electron, so use typecheck/build
for ordinary verification. Platform vault behavior needs release smoke tests
on each supported OS. See [build instructions](../BUILD.md).
