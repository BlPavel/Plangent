# Server MCP

`api/mcp/server.ts` serves session-scoped MCP over HTTP. Each session receives
a random bearer token; `stdio-proxy.cjs` bridges agents requiring stdio.
Configuration is wired into agents at application startup.

`api/mcp/tools/` contains domain definitions and handlers. Each tool declares
description, fields, required arguments, string validation and ordered role
access. The registry drives listing and dispatch. Handlers call core public
APIs instead of accessing persistence or external providers.

Every call checks the session profile and active turn. Profiles include
read-only execution, branch review and full finish workflows. `git_action`
requires an ordinary project and excludes private MR review. Domain services
also validate resource ownership and workflow state.

The librarian edits single-text instructions (guide, code-fixer, commit rules, templates, review and
interview instructions) like list items: `get_instruction_text` reads the text in force, then
`propose_library_change` updates or creates it. Their slug is fixed, there is one per level, and review
and interview instructions are global only (`core/library/instruction-texts.ts`).

Add tools to their domain registry and update the intentional role snapshot in
`api/mcp/roles.snapshot.json` when access changes. `registry.test.ts` verifies
the registry through `npm test`. See [agents](agents.md) for permissions.
