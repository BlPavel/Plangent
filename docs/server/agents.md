# Server agents

`core/agents/catalog/` owns presets, installation, limits and ACP options.
`core/agents/sessions/` owns state, prompt queues, modes and permissions.
Consumers import the public `core/agents` API.

Use `selectAgent` and the settings resolver for agent choice.
`createAgentSession` translates mode/config preferences; `runAgentWork`
starts or prompts a session and records delivery failures. Register
`waitForAgentTurn` before launch and dispose its listeners. Use the shared
one-shot helper instead of creating another adapter launcher.

Roles select instructions and [MCP](mcp.md) tools; read-only policy restricts
writes. Session permissions check shell/file access. Agents may read Git state,
but writing Git operations go through Plangent's checked tools and
[Git workflows](git.md), never shell commands. Chat Git actions require the
turn's Git permission and an ordinary project.

`infrastructure/acp/` owns adapter processes, protocol transport, probes and
shutdown. Completed executor, task-reviewer and plan-reviewer work uses a
one-minute idle deadline, including preflight and architecture/QA review.
Other idle sessions use five minutes. Active turns and pending permissions
must finish before shutdown. Non-resumable adapters are stopped too; a later
message starts a new conversation when session loading is unavailable.

`completeAgentWork` and `markAgentWorkFinished` record completed work for this
policy. Idle-policy and session tests run through `npm test`.

Code fixer sessions with allow-edits or allow-all use an execution mode with workspace writes.
Their review picker leaves mode selection to the server. Ignore a saved read-only, plan or
discuss preference for these sessions: older clients inherited it from the option probe.
Explicit read-only policies and other session roles keep their mode preferences.
