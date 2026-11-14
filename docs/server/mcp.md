# Server MCP

`api/mcp/server.ts` serves session-scoped MCP over HTTP. Each session receives
a random bearer token; `stdio-proxy.cjs` bridges agents requiring stdio.
Configuration is wired into agents at application startup.

`api/mcp/tools/` contains domain definitions and handlers. Each tool declares
description, fields, required arguments, string validation and ordered role
access. The registry drives listing and dispatch. Handlers call core public
APIs instead of accessing persistence or external providers.

`get_task_context` (`tools/execution.ts`, `core/work/task-context.ts`) gives a task's follow-up agent (`task-chat`) the task, plan,
analysis, executors' reports and changed files on demand; its briefing is only a pointer to the tool.

`run_command` and `command_output` (`tools/commands.ts`) are given to the chat, task-chat, errand, executor and code-fixer
roles, never to read-only profiles or private MR reviews. See [agents](agents.md) for how commands are authorized and limited.

Every call checks the session profile and active turn. Profiles include
read-only execution, branch review and full finish workflows. `git_action`
requires an ordinary project and excludes private MR review. Domain services
also validate resource ownership and workflow state.

The librarian edits single-text instructions (guide, code-fixer, commit rules, templates, review and
interview instructions) like list items: `get_instruction_text` reads the text in force, then
`propose_library_change` updates or creates it. Their slug is fixed, there is one per level, and review
and interview instructions are global only (`core/library/instruction-texts.ts`).

The interview (`/interview` in analysis, plan, architecture and QA chats) runs in rounds.
`get_interview_guide` returns the editable instruction, the section focus and its tools;
`ask_interview_questions` (`core/library/interview-instruction.ts` validates it) records an
`interview_questions` event: 1–6 questions, each with 2–4 options and at most one recommended.
The chat renders it as a card where the developer can also write an own answer or ask to
clarify. The answers are an ordinary prompt; its text block carries
`_meta.plangent_interview` (`InterviewAnswersMeta`) linking it to the round, so the card shows
them instead of a message bubble. Only the newest round can be answered. A question asked
again after a clarification request keeps its id; the card marks it «После уточнения».

Until the interview ends, `callTool` refuses the section's save tool (`interviewBlocksTool`):
the agent may not do the developer's wish before all rounds. It ends with the answers to the
round numbered `total_rounds` without clarification requests, or when the developer presses
«Завершить интервью» (`finish` in the meta).

Librarian chats opened from global settings carry `metadata.library_scope = 'global'`.
Their project supplies code context only: `get_instruction_text` reads the global
text, and proposals target the global level. Updates to project items are rejected.
The scope is preserved when starting a new conversation with the previous context.
`metadata.library_section` identifies the settings or project instruction section
that owns the chat. Preserve it on context continuation; the client filters chat
history and keeps composer drafts separate by section and scope.
The section also determines editing target types (`common/library-registry.ts`,
consumed by `library/chat-context.ts`).
Every librarian turn receives this context independently of the user's text;
`get_library` reports it, and proposal creation rejects unrelated item types.

Library proposals persist `base_content`, the text in force before the proposed
change. Creating a custom text instruction compares against its inherited or
built-in text; creating an unrelated item compares against an empty string.
The item snapshot remains separate and is used for update conflict detection.
New text proposals also save an optional effective-instruction snapshot, so a
changed inherited source makes them stale. See [library operations](library.md).

Add tools to their domain registry and update the intentional role snapshot in
`api/mcp/roles.snapshot.json` when access changes. `registry.test.ts` verifies
the registry through `npm test`. See [agents](agents.md) for permissions.
