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

Agents run shell commands through the Plangent MCP tool `run_command`
(`sessions/shell-commands.ts`), not their own shell. Once a session has the
tool, `permissionDecision` refuses the agent's native `execute` calls (a single
read-only `git` command excepted) with a pointer to the tool. The tool applies
the session policy like a native command: dangerous commands and every policy
except `allow-all` ask the developer, read-only refuses. The folder must lie
inside the session's folders. The agent marks a command `heavy` (default) or
light. Heavy commands take one of a limited number of slots shared by all
sessions (`infrastructure/terminal/command-slots.ts`, first come first served,
in memory). The limit is the app setting `command_slots`; empty means a quarter
of the cores, at least two. Output is cleaned and shortened
(`output-trim.ts` keeps the start and the end); the full log stays in a
temporary file for `command_output`. Queue timeout, run timeout and
cancellation are separate result statuses, not exit codes. ACP `terminal` is
not used: the Claude and Codex adapters never call it.

An errand's chat can change its agent (`POST /api/agent-sessions/:id/agent`,
`switchAgent`): between turns only. The old process stops, `acp_session_id` and
the options the old agent reported are cleared, and the new agent starts at once;
the conversation goes to it with the next message through `needsContext`.

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
