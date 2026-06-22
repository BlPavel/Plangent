# Design: Task Orchestration & Plan Execution

> **Audience:** This document is written for an AI coding agent that will implement
> the feature. It is a complete, self-contained specification. Read it fully before
> writing code. Where it says "MUST", treat it as a hard requirement. Where file
> paths and line numbers are referenced, verify them against the current code before
> editing (the codebase may have drifted).

---

## 1. Context & Problem Statement

Plangent is a single-developer AI orchestrator (Node.js/TS backend + Vue 3 frontend).
Today a `Task` can hold a markdown `Plan` and a history of `Run`s, and the user can
launch an agent (Claude Code / Codex CLI) against a task. The current flow is
incomplete:

1. The agent writes `PLAN.md` into the repo root, but **the file is never synced
   back into the DB** — progress shown in the UI is stale.
2. After launching an agent, **the prompt is "typed" into the TUI and frequently is
   not submitted** — the user must press Enter manually (`server/api/routes/runs.ts`
   sends the prompt via `sendToAgent` after a fixed 3s delay; `server/adapters/generic.ts`
   writes `text + '\r'`, which a multiline TUI input does not reliably submit).
3. **There is no way for the app to know when an agent finished** a unit of work, so
   nothing can be chained automatically.
4. There is **no batching / queue / parallel** execution model.

This design turns Plangent into a **human-in-the-loop orchestrator**: the AI plans and
executes, but the developer reviews and is the only actor who touches git.

### Hard constraints (from product owner)

- **The agent NEVER interacts with git.** No commits, no branches, no MRs/PRs.
  All review and all commits are done by the developer.
- The agent's terminal session **stays open** after it finishes a unit of work, so the
  developer can keep interacting with that agent on the same context.
- The developer decides **how the plan is executed**: which points go into which
  session, in which order, and what runs in parallel.
- No git worktrees. Parallelism happens in the same working directory and is only
  allowed for points that touch disjoint files (see §7).

---

## 2. Glossary

- **Point** (a.k.a. step): a single checklist item in a plan (`- [ ] ...` / `- [x] ...`).
- **Plan**: ordered list of points + free-form prose, stored as markdown. One active
  plan per task (versioned).
- **Session**: **one fresh launch of a terminal + agent** covering one or more points.
  A session has its own (fresh) context. This is the unit the developer assigns points to.
- **Queue**: an ordered list of sessions the developer composes *before* pressing "Run".
  The orchestrator runs the queue to completion, then stops for review.
- **Parallel group**: a set of sessions marked (by the AI, approved by the developer)
  as safe to run concurrently because their points touch disjoint files.
- **Plan Protocol**: the fixed, machine-readable contract for how a plan is structured
  (owned by Plangent). Distinct from **plan skills** (domain guidance owned by the user).

---

## 3. Source of Truth & Storage Model

**The database is the single source of truth for the plan and all progress.**

- The full plan markdown lives in `plans.content` (already the case — see
  `server/storage/plans.ts`). The DB stores **both** the parsed points and the full
  rendered plan markdown.
- The on-disk plan file is an **ephemeral, derived working copy** (Variant B, below).
  It is never committed to git and is always reconstructable from the DB.

### Plan file (ephemeral working copy)

- Path: `<repo_path>/.plangent/<task-key>.plan.md` (one file per task; the whole
  `.plangent/` directory is the working area).
- Created (materialized from `plans.content`) **when a session starts**.
- The agent edits this file in place (checks off `- [x]` as it completes points).
- Plangent watches the file (`fs.watch`) and syncs changes back into `plans.content`
  and the parsed point statuses in the DB.
- Removed when the session ends and removed when the task is marked `done`.
- The file MUST be invisible to git: add `.plangent/` to the project's
  `.git/info/exclude` block via the existing mechanism (`applyGitExclude` in
  `server/skills/syncer.ts:124`). Do **not** modify the tracked `.gitignore`.

**Invariant (critical):** the plan file is *always* derived from the DB and is *always*
safe to delete based on task status. A reconcile sweep (see §11) can delete any plan
file whose task is not actively running on this machine. This invariant is what makes
future cross-machine sync cheap — do not break it.

---

## 4. The Plan Protocol vs Plan Skills

This separation is the backbone of the design. Implement it deliberately.

### 4.1 Plan Protocol (owned by Plangent, fixed, machine-readable)

The protocol is the **only** thing Plangent parses, so it must be stable and small.
Plangent **always injects the protocol into the prompt** when asking an agent to
create or update a plan — independent of any user skill. This guarantees the plan is
parseable even if the user rewrites or removes their skills.

A valid plan file is markdown with:

1. **YAML frontmatter** (required keys):
   ```yaml
   ---
   plangent: 1            # protocol version, integer
   key: PROJ-123          # task key
   title: Short title
   status: open|in_progress|done
   ---
   ```
2. **Points** as GitHub-style checkboxes, each with a stable id and optional parallel tag:
   ```
   - [ ] (p1) Create models in folder N
   - [ ] (p2) Create models in folder M  @parallel:groupA
   - [x] (p3) Wire up the service        @parallel:groupA
   ```
   - `(pN)` — stable point id. Required. Plangent assigns ids when it first ingests a
     plan that lacks them, then rewrites the file with ids so they stay stable across edits.
   - `@parallel:<groupName>` — optional. Points sharing a group name are declared by the
     AI as safe to run concurrently (disjoint files). Absence = sequential.
3. Any other prose, headings, sections — **free-form**, ignored by the parser.

Extend the existing parser (`parsePlanSteps` / `markStepDone` in
`server/storage/plans.ts`) to:
- parse frontmatter,
- parse `(pN)` ids and `@parallel:` tags,
- assign missing ids and rewrite the file,
- expose `PlanStep` enriched with `id` and `parallelGroup`.

**Validation:** after an agent produces/updates a plan, Plangent validates it against
the protocol. If unparseable (no frontmatter, no points), Plangent auto-sends a
follow-up message into the same session: *"Reformat the plan per the Plangent plan
protocol: frontmatter + `- [ ] (id) text` checkboxes."* Cap retries (e.g. 2) and
surface a clear error to the UI if it still fails.

### 4.2 Plan Skills (owned by the developer, free-form, swappable)

- Domain guidance ("for frontend use X", "for backend split by module", "for mobile…")
  lives entirely in the user's **skills**, using the existing skill system
  (`server/skills/*`, library items, per-project deploy).
- **Plangent has NO built-in notion of frontend/backend/mobile.** New domains = new
  user skills, zero code changes.
- The developer does NOT select a skill per task. The agent discovers and activates
  the appropriate plan skill on its own (skill descriptions contain their own
  activation conditions). Do **not** build per-task skill selection.

The contract between the two layers: **the protocol guarantees the *format*; the skill
shapes the *content*.** Plangent only ever depends on the protocol.

---

## 5. Auto-start (eliminate manual Enter)

Replace the current "launch agent, wait 3s, type prompt, send `\r`" flow.

- **First prompt of a session:** pass the prompt as a launch argument so the agent
  boots already working — e.g. `claude "<prompt>"` / `codex "<prompt>"`. To avoid
  shell-escaping pain with large/multiline prompts, write the prompt to a temp file and
  launch with `"$(cat <tmpfile>)"`, or use the agent's prompt-file flag if available.
  Make this configurable per agent (the prompt-injection style belongs in the
  `Agent` config / `layout_profile`, since different CLIs differ). Verify exact flags
  for the installed Claude Code / Codex versions before finalizing.
- **Subsequent messages into a live session** (e.g. protocol-reformat follow-ups, or
  the developer's manual input): send the text, then send a **separate** carriage
  return after a short delay (~800ms–1s) as a distinct write. Many TUIs require Enter
  as its own event after a paste.

Keep `sendToAgent` for the live-session case but split it so the Enter is a separate,
delayed write. Document the chosen approach inline.

---

## 6. Completion detection (agent hooks)

The interactive agent CLI does not exit when it finishes a unit of work — it returns to
waiting for input. So process-exit cannot signal completion. Use **agent hooks** that
call back into Plangent.

- Extend the existing per-agent deploy mechanism (the same place skills are deployed
  before launch and cleaned up after — `server/skills/syncer.ts`, `server/adapters/generic.ts`)
  to also deploy a **hook config** before launch and remove it after:
  - **Claude Code:** a `Stop` hook in a deployed `.claude/settings.json` that runs a
    command calling back to Plangent.
  - **Codex CLI:** the `notify` program setting, pointed at the same callback.
- Pass identifying context to the agent via **env vars** (env injection already exists —
  see `agent.env` / `extra_env` in `server/adapters/generic.ts`):
  - `PLANGENT_RUN_ID` — the run id,
  - `PLANGENT_CALLBACK_URL` — e.g. `http://localhost:3000`.
- The hook calls: `POST /api/projects/:pid/tasks/:tid/runs/:runId/agent-stopped`.
- Verify exact hook event names and the JSON payload shape for the installed agent
  versions before finalizing. If a CLI lacks a usable hook, fall back to output
  quiescence (watch the PTY stream; treat "no output change for N seconds + idle
  prompt visible" as a stop) — but hooks are the primary, preferred mechanism.

**Important semantics:** the Stop hook means "the agent yielded control", NOT
necessarily "the work is done". Therefore the hook is only a **trigger** — see §8 for
how completion is actually decided.

---

## 7. Execution model: sessions, queue, parallel groups

### Session
- A session = one fresh agent launch covering an ordered subset of points.
- Putting multiple small points in one session is how the developer **saves tokens /
  keeps context** (the agent does them all in one context instead of re-priming).
- The session's terminal **stays open** after completion for developer interaction.

### Queue
- Before running, the developer composes a queue, e.g.:
  - Session 1 → points `p1,p2,p3` → agent A
  - Session 2 → point `p4` → agent B
- The orchestrator runs the queue **in order, auto-advancing between sessions**, then
  stops at the end of the queue. The end of the queue is the review point.
- **No automatic commit happens between sessions.** A queue is "a chunk of work the
  developer will review and commit together". If the developer needs to commit between
  two sessions, that is simply two separate queue runs.
- There is no separate "checkpoint" concept — the end of a queue *is* the checkpoint.

### Parallel groups
- The AI annotates points with `@parallel:<group>` when they touch disjoint files and
  are independent (e.g. "models in folder N" vs "models in folder M").
- This is a **recommendation**. The developer reviews/edits it in the UI before running.
- Sessions whose points are all in the same approved parallel group may be launched
  **concurrently** (multiple terminals at once). Because the points are disjoint and the
  agent never commits, running in the same working directory is safe. If points are not
  marked parallel, they run sequentially.
- Do NOT implement git worktrees. Disjoint-file parallelism in one directory is the
  whole model.

---

## 8. The Orchestrator (new server service)

Create a server-side `Orchestrator` (e.g. `server/orchestrator/orchestrator.ts`) that
drives a queue for a task. It is a state machine.

### Responsibilities
1. Accept a **run plan** from the UI: an ordered list of sessions, each with
   `{ points: pointId[], agentId, parallelGroup? }`.
2. Set task status → `in_progress`.
3. For each step of the queue (a single session, or a set of parallel sessions):
   - Materialize the plan file from the DB if not present (§3).
   - Build the prompt for that session (only the points assigned to it + protocol +
     task/description + relevant run history). Reuse/extend `buildPrompt` in
     `server/adapters/generic.ts`.
   - Launch the agent with the prompt injected as a launch arg (§5). Create a `Run`.
   - Wait for the **Stop hook** callback (§6).
4. **On Stop callback:** re-read the plan file → parse point statuses. Decide:
   - **All points assigned to this session are `- [x]`** → session complete → advance
     the queue (start the next session / parallel set). Update DB.
   - **Not all complete** → the agent yielded mid-work (likely asked a question or got
     stuck). Do NOT advance. Mark the session `waiting_for_developer` and surface it in
     the UI; keep the terminal open. The developer interacts and can re-trigger.
5. When the queue is exhausted → emit a "queue finished" event; stop. Task stays
   `in_progress` (the developer reviews and commits). The developer later clicks
   "Mark done" to set status `done`.
6. On failure → mark the run failed, stop the queue, emit an event.

### Progress truth
- **Point completion is decided by the checkbox state in the plan file, not by the hook
  firing.** The hook only tells the orchestrator *when to re-read*. The agent is
  instructed (via the protocol) to check off `- [x]` as it finishes each point.
- `fs.watch` on the plan file keeps the DB live during a session (independent of the
  hook), so the UI progress bar updates as the agent works.

### Events to UI
Push real-time events over the existing WebSocket layer (terminal WS exists; add an
orchestrator channel or reuse). Events: `session_started`, `point_done`,
`session_complete`, `session_waiting`, `queue_finished`, `run_failed`. The UI uses
these to update progress, statuses, and the "next session starting" indicator.

---

## 9. Task lifecycle & statuses

`Task.status`: `open → in_progress → done` (enum already exists in
`server/models/types.ts`).

- `open`: created, maybe has a plan, not running.
- `in_progress`: set when a queue starts. Stays in progress across review pauses.
- `done`: set **only** by an explicit developer action ("Mark done"). On `done`:
  - The orchestrator ensures the latest plan markdown is persisted to `plans.content`.
  - Delete the on-disk plan file (and the `.plangent/` entry).
  - The DB record (full markdown + points + run history) is **retained**.

Plan creation flow (developer types "create a plan" in a terminal):
- The agent writes the plan file per the protocol (guided by its plan skill).
- `fs.watch` ingests it → creates/updates `plans.content` + parsed points → a task with
  points appears in the UI. (This also closes the existing "PLAN.md not synced" gap.)

---

## 10. API changes

Existing routers: `server/api/routes/{tasks,plans,runs}.ts` mounted under
`/api/projects/:projectId/tasks/:taskId/...`. Add:

- `POST /projects/:pid/tasks/:tid/runs/:runId/agent-stopped` — hook callback. Body may
  include agent-provided payload; the orchestrator re-reads the plan file and decides
  advancement. Must be safe to call from `curl` on localhost.
- `POST /projects/:pid/tasks/:tid/execute` — start a queue. Body:
  ```json
  {
    "sessions": [
      { "points": ["p1","p2","p3"], "agentId": "agent-claude", "parallelGroup": null },
      { "points": ["p4"], "agentId": "agent-codex", "parallelGroup": null }
    ]
  }
  ```
  Returns a queue/run-set id and per-session run ids + session ids.
- `POST /projects/:pid/tasks/:tid/done` — mark task done (triggers plan-file deletion).
- `GET /projects/:pid/tasks/:tid/orchestrator` — current queue state for the UI to
  rehydrate (which session is active/waiting/done).
- Keep existing `runs` endpoints for attach/input/kill/finish; the orchestrator owns
  the higher-level flow but reuses run records.

Plan parsing endpoints (`plans.ts`) must return enriched points (`id`, `parallelGroup`,
`done`).

---

## 11. Cross-machine sync (FUTURE — do NOT implement now)

Documented so the invariants are respected today.

- The plan + statuses sync across machines **at the DB level** (a central Plangent
  server, or syncing the sqlite file) — **separate from git**. Code syncs via the
  developer's git commits; the plan never enters git.
- Because the plan file is strictly derived from the DB (§3), cleanup is automatic and
  idempotent: on startup / on connect, run a **reconcile sweep** that walks each
  project's `.plangent/` directory and deletes any plan file whose task is not
  `in_progress` on this machine. A machine that finished a task elsewhere self-heals on
  next launch (it sees `status=done` via DB sync and removes the orphan file).
- **Today's requirement:** keep the file always reconstructable from the DB and always
  deletable by task status. Do not store anything in the file that is not in the DB.

---

## 12. UI changes (`client/src/views/TaskView.vue` and friends)

- **Points list** with checkboxes (read-only progress is driven by DB/WS), each point
  showing its id and parallel-group badge.
- **Queue builder**: the developer selects a set of points, picks an agent, and clicks
  "Add as session". Repeat to append more sessions. Sessions show their points + agent.
  Parallel-group recommendations from the AI are pre-highlighted and editable.
- **Run button** executes the composed queue via `POST .../execute`.
- **Live state**: per-session status chips (`queued`, `running`, `waiting`, `done`,
  `failed`), driven by orchestrator WS events. The "next session starting automatically"
  transition is visible.
- Terminals stay open and attachable (multi-session terminal support already exists in
  `TaskView.vue`). A `waiting_for_developer` session focuses its terminal so the
  developer can intervene.
- **Mark done** button → `POST .../done`.
- Plan editor remains for manual edits; edits write to the DB (and to the live file if a
  session is active).

---

## 13. Implementation task list (ordered)

Implement in this order; each step should leave the app working.

1. **Plan protocol parser.** Extend `server/storage/plans.ts`:
   frontmatter parsing, `(pN)` ids (assign + rewrite if missing), `@parallel:` tags,
   enriched `PlanStep`. Update `server/models/types.ts` (`PlanStep` gets `id`,
   `parallelGroup`). Unit-test the parser against malformed input.
2. **Plan file materialize + watch + git-exclude.** Service to write
   `.plangent/<key>.plan.md` from `plans.content`, `fs.watch` → DB sync (debounced),
   delete on session end / task done. Extend `applyGitExclude` to include `.plangent/`.
3. **Auto-start.** Change agent launch to inject the first prompt as a launch arg
   (temp-file approach). Split `sendToAgent` so live-session Enter is a separate delayed
   write. Make injection style configurable per agent.
4. **Hooks + callback.** Deploy `Stop`/`notify` hook config per agent before launch,
   remove after. Inject `PLANGENT_RUN_ID` / `PLANGENT_CALLBACK_URL` env. Add
   `agent-stopped` endpoint. Verify hook payloads for installed CLI versions.
5. **Orchestrator service + `execute` endpoint.** Queue state machine (§8), sequential
   advancement first.
6. **Parallel groups.** Allow concurrent sessions within an approved parallel group.
7. **Task lifecycle.** `in_progress` on execute; `done` endpoint deletes plan file,
   retains DB.
8. **WS events + UI.** Queue builder, per-session status, live progress, mark-done,
   waiting-session focus.
9. **Protocol injection + validation/auto-reformat** in the plan-creation prompt.
10. **(Future, not now)** reconcile sweep for cross-machine cleanup.

---

## 14. Edge cases & rules

- **Agent yields without finishing all its points** → `waiting_for_developer`; do not
  advance; focus terminal. Developer can type into the session and/or re-trigger that
  session.
- **Agent edits the plan file mid-session** (re-plans) → `fs.watch` re-ingests; the
  orchestrator must re-resolve which points belong to the running session by **id**, not
  by index (ids are stable; indexes shift).
- **Concurrent writers to the plan file** (agent + Plangent rewriting ids, or developer
  editing in UI) → treat the file as last-write-wins, debounce the watcher, and after any
  Plangent write, reload. Avoid write loops (ignore the watch event Plangent itself
  caused).
- **Parallel sessions** must only ever be auto-launched within a single approved
  parallel group; never auto-parallelize ungrouped points.
- **Agent must never run git.** This is enforced by instruction (protocol/skill) and by
  not giving it any git step; the design assumes the developer commits. Do not add any
  git automation.
- **Large prompts** → temp-file injection; clean up temp files after launch.
- **Hook reliability** → if a Stop callback never arrives within a timeout, surface the
  session as `running` with a "no completion signal" warning; allow manual advance.
  (Optional quiescence fallback.)

---

## 15. Acceptance criteria

1. Typing "create a plan" in a terminal results in a task with parsed points appearing
   in the UI, with no manual sync.
2. Launching a session starts the agent **already working** — no manual Enter.
3. Composing a queue of two sessions runs session 1, then **automatically** runs
   session 2, then stops for review — with no commits performed by the app/agent.
4. Putting three points in one session runs them in a single agent context (one launch).
5. Point checkboxes in the UI update live as the agent checks them off in the file.
6. A parallel group recommended by the AI can be approved and its sessions run
   concurrently.
7. Marking a task done deletes the on-disk plan file but the plan (full markdown +
   points) remains queryable in the DB.
8. Rewriting the user's plan skill does not break plan parsing (protocol is injected
   independently).
9. No plan file is ever tracked by git.
```
