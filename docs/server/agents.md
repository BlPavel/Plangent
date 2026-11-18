# Server agents

`core/agents/catalog/` owns presets, installation, limits and ACP options.
`core/agents/sessions/` owns state, prompt queues, modes and permissions.
Consumers import the public `core/agents` API.

Agent presets use the shared `AgentPreset` contract. Optional `env` defaults
are copied into the settings form when a preset is applied; credentials in
shipped presets stay empty. Applying a preset clears model/effort overrides
from the previous adapter. DeepSeek uses the Claude ACP adapter with DeepSeek's
Anthropic-compatible endpoint and model environment variables, including its
background/subagent models. Its `command` stays empty so Claude account usage
is not displayed as DeepSeek usage. Set `ANTHROPIC_AUTH_TOKEN` in the agent's
environment to a DeepSeek API key before starting a conversation.

GLM (Z.ai) and Kimi (Moonshot API) use the same ACP adapter. GLM uses
`https://api.z.ai/api/anthropic`, a Z.ai GLM Coding Plan key, and `glm-5.3[1m]`.
Kimi uses `https://api.moonshot.ai/anthropic`, a Moonshot platform API key,
and `kimi-k3[1m]`; this is separate from Kimi Code subscription credentials.
Both presets map all Claude model tiers (including Fable) and subagents to
their configured provider model. Supply the key in `ANTHROPIC_AUTH_TOKEN`.
References: [Z.ai](https://docs.z.ai/devpack/tool/claude),
[Kimi](https://platform.kimi.ai/docs/guide/claude-code-kimi).

The separate `kimi-code` preset is for Kimi Code subscription benefits. It uses
`https://api.kimi.ai/coding/`, model `k3.1-pro`, and a 262144-token context cap.
Put the Kimi Code Console key in `ANTHROPIC_API_KEY`; leave
`ANTHROPIC_AUTH_TOKEN` empty. It uses the same model for all tiers and subagents.
An active membership with Kimi Code benefits is required. Reference:
[Kimi Code setup](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html).

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
tool, `permissionDecision` refuses the agent's native `execute` calls with a pointer
to the tool, except a single read-only `git` command and one plain file read, listing
or search (`isPlainReadCommand`: `cat`, `Get-Content`, `ls`, `rg` and similar, without
operators, redirection, expansion or options that run or follow anything). Agents
without a native read tool read files that way, in any policy. The tool applies
the session policy like a native command: dangerous commands and every policy
except `allow-all` ask the developer, read-only refuses. The folder must lie
inside the session's folders. The agent marks a command `heavy` (default) or
light. Heavy commands take one of a limited number of slots shared by all
sessions (`infrastructure/terminal/command-slots.ts`, first come first served,
in memory). The limit is the app setting `command_slots`; empty means a quarter
of the cores, at least two. Output is cleaned and shortened
(`output-trim.ts` keeps the start and the end); the full log stays in a
temporary file for `command_output`. Queue timeout, run timeout and
cancellation are separate result statuses, not exit codes. File reads and edits use the
agent's native file tools under the session's file permissions; command redirection does
not require a read-only sandbox and does not put file operations in the command queue.
ACP `terminal` is not used: the Claude and Codex adapters never call it.

New-session pickers leave the mode automatic unless the developer explicitly selects one.
An empty mode is not a saved preference: the server selects a compatible mode from the
session's policy (workspace writes for allow-edits/allow-all when available). The mode
reported by an options probe must not become an implicit read-only preference. Explicit
read-only/discussion choices remain effective for ordinary chats and errands. Existing
sessions keep their saved choices; change their mode explicitly when needed.

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

`complete_step` records completion once. Repeated calls after completed work have no
side effects and emit no completion card. Follow-up turns receive a reminder to
continue reading, editing and discussing without calling it again. Errands commit
completion after a successful turn; cancelled or failed completion turns may be retried.

Code fixer sessions with allow-edits or allow-all use an execution mode with workspace writes.
Their review picker leaves mode selection to the server. Ignore a saved read-only, plan or
discuss preference for these sessions: older clients inherited it from the option probe.
Explicit read-only policies and other session roles keep their mode preferences.
