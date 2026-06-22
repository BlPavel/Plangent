# Design: Task UX Redesign — Planning vs Execution

> **Audience:** This document is written for an AI coding agent that will implement
> the feature. It is a complete, self-contained specification. Read it fully before
> writing code. Where it says "MUST", treat it as a hard requirement. Where file
> paths and line numbers are referenced, verify them against the current code before
> editing (the codebase may have drifted).

---

## 1. Context & Problem Statement

Plangent's task screen (`client/src/views/TaskView.vue`) currently crams **planning**
and **execution** into a single two-column page, and the task's intent ("what to do")
is entered once in the creation modal as a `description` field that is afterwards
**invisible and uneditable**. Concrete problems:

1. **Creating a plan is not discoverable.** There is no "make a plan" action. A plan
   is produced as a side effect of pressing "▶ Запустить" in the quick-launch block
   (`TaskView.vue`), which launches an agent whose prompt happens to say "create a
   plan" when no plan exists (`server/adapters/generic.ts`, `buildPrompt` else-branch).
2. **The intent is write-once.** `description` is captured in the create-task modal
   (`client/src/views/HomeView.vue`) and never shown or edited again.
3. **No good way to reference files/docs** when describing the task.
4. **The screen is overloaded** — plan editing, queue building, run history and
   terminals all compete on one surface.

### Decisions (from product owner)

These were settled in discussion and are **hard requirements**:

- **The prompt is a conversation with the agent, not a stored field.** The only
  persistent artifact of intent is the **Plan** itself. There is no stored "brief"
  and no prompt-versioning. To change direction, the developer talks to the agent in
  the live session (or starts a fresh session that reads the existing plan).
- **Task creation captures only `key` + `title`.** `key` MUST be unique.
- **`description` stays in the data model** as the landing spot for future structured
  imports (e.g. Jira — `Task.jira_url` / `Task.description` already exist in
  `server/models/types.ts`), but it is **removed from the create-task modal**.
- **The task screen splits into two tabs: "План" and "Выполнение".** Terminals remain
  a global dock at the bottom, shared across both tabs (multi-session minimize/restore
  already exists in `TaskView.vue`).
- **File references / paste / `@`-mentions happen in the terminal**, natively. The
  terminal already forwards every keystroke to the agent CLI (so the agent's own `@`
  file-picker works) and already handles Finder paste / drag-drop / image attach
  (`client/src/components/TerminalPane.vue` — see `term.onData`, `onPaste`, `onDrop`).
  Do **NOT** build a custom `@`-autocomplete in a Vue input; it would be strictly worse.
- **Skills are NOT deployed per launch.** The library sync mechanism
  (`server/skills/syncer.ts` — `syncItem` / `syncAll`) already writes skills to disk
  persistently, so a launched agent picks up plan-writing skills natively. The agent
  self-activates the relevant plan skill by its description (per the existing Plan
  Protocol vs Plan Skills separation in `DESIGN-task-orchestration.md` §4).

---

## 2. The Plan Creation Model

A plan can be created two ways, both converging on the **same source of truth**
(`plans.content`, parsed by `parsePlanSteps` in `server/storage/plans.ts`):

1. **Manual** — the developer writes/edits the plan markdown in the existing editor
   (`TaskView.vue`, `savePlan` → `POST`/`PATCH /plans`).
2. **With an agent (primed planning session)** — the developer picks an agent and
   clicks "Сделать с помощью агента". Plangent launches an agent whose first
   (auto-injected) prompt **primes it for planning** (protocol + "you are about to
   write the plan; wait for my description; do not execute"). Plan-writing skills are
   already on disk. The developer then describes the task **in the terminal** (with
   `@`-mentions, pasted files, etc.). The agent writes the plan file; Plangent ingests
   it into the DB; the "План" tab fills in live.

**Refinement is conversational.** "I don't like this plan" → the developer tells the
agent in the same live session ("split the backend by module instead") → the agent
rewrites the plan file → `fs.watch` re-ingests → the UI updates. A fresh session reads
the existing plan as context (`buildPrompt` already injects current plan), so no stored
prompt is needed even across sessions.

---

## 3. Backend Changes

### 3.1 Planning-mode prompt — `server/adapters/generic.ts`

- Add `purpose?: 'plan' | 'execute'` to `RunContext` (default `'execute'` = current
  behaviour; do not change execution prompts).
- In `buildPrompt`, when `purpose === 'plan'`, replace the current instruction
  else-branch with a planning primer (always include `planFilePath`):
  - **plan exists** → "The developer wants to revise the plan. Wait for their
    instructions in this session, then update the plan file `<path>` per the protocol.
    Do NOT execute or run code."
  - **no plan, `description` present** → "Write a plan for the task above into
    `<path>` per the protocol, then STOP for review. Do NOT start executing."
  - **no plan, no `description`** → "The developer will describe the task in this
    session. Wait for their message, then write the plan into `<path>` per the
    protocol. Do NOT execute."
- The protocol header (`PLAN_PROTOCOL_HEADER`) and `taskDescription` are already
  emitted — reuse them.

### 3.2 Ingest agent-created plans — `server/services/plan-file.ts`

The current `watchPlanFile` only `updatePlan`s an **existing** `planId` and requires
the file to already exist — it cannot capture a *first* plan. Add:

- `watchPlanDirForCreate(task, repoPath)`:
  - Ensure `.plangent/` exists; if `project.hide_from_git`, call `applyGitExclude`
    (exported from `server/skills/syncer.ts`) once so the dir never enters git.
  - `fs.watch` the `.plangent/` **directory** (the file does not exist yet) waiting for
    `<key>.plan.md` to appear.
  - On first content: `assignMissingIds` → `createPlan({ task_id, content })`
    (`server/storage/plans.ts`), `markPlangentWrite`, then hand off to the existing
    `watchPlanFile(task, newPlan.id, repoPath)` for continued sync, and stop the
    directory watcher.
  - `broadcast({ type: 'plan_updated', taskId, steps })` (via `server/services/events.ts`,
    same as `watchPlanFile`) so the UI picks up the new plan.

### 3.3 Planning launch — `server/api/routes/runs.ts`

Extend the existing `POST /runs` (do not add a new route):

- Read `purpose` from the body; pass it plus `planFilePath`
  (`getPlanFilePath(project.repo_path, task.key)` from `plan-file.ts`) into `buildPrompt`.
- When `purpose === 'plan'`:
  - **no plan yet** → call `watchPlanDirForCreate` (§3.2) before/around `launchAgent`.
  - **plan exists** → `materializePlanFile` + `watchPlanFile` so the agent's edits sync.
- Leave the `execute` path unchanged (the orchestrator owns it).
- Response shape is unchanged (`run`, `session_id`, `mode`).

---

## 4. Frontend Changes

### 4.1 Create-task modal — `client/src/views/HomeView.vue`

- Remove the `description` `FormField`. `taskForm` becomes `{ key, title }`.
- Validate `key` uniqueness inline against the already-loaded `tasks` before
  `createTask`; on collision show a toast and do not submit. (Server validation still
  applies as backstop.)

### 4.2 Task screen tabs — `client/src/views/TaskView.vue`

Add a local `activeTab: 'plan' | 'exec'` with a tab bar under the task header. The
terminal dock and minimized session bars stay global, below the tabs.

- **"План" tab** (move the existing plan panel here):
  - **Empty (no plan):** agent picker + "▸ Сделать с помощью агента" (§4.3) +
    "Написать вручную" (opens the existing editor) + hint: *"опишите задачу агенту в
    терминале — работают `@файлы`, перетаскивание и вставка файлов"*.
  - **With plan:** progress bar + read-only steps list + markdown editor (`savePlan`,
    `markStepDone` unchanged).
- **"Выполнение" tab** (move the existing queue panel here):
  - Its **own** selectable points list (move `selectedStepIds` / `toggleStepSelection`
    here — selecting points is an execution concern) + session builder (agent, parallel
    group, "+ Добавить сессию") + queue list + "▶ Запустить очередь" + run history.
  - **Remove** the old quick-launch block (planning launch now lives in "План").

### 4.3 Planning launch + live ingest — `client/src/views/TaskView.vue`

- Generalize `launchDirect` to accept `purpose`; add `launchPlanning()` that
  `POST`s `/runs` with `{ agent_id, purpose: 'plan' }` and opens a terminal session in
  the dock (same as `launchDirect`).
- In the WS handler, on `plan_updated` when `plan.value === null`, call `loadPlan()`
  (the agent just created the first plan) and stay on the "План" tab.

---

## 5. Future (do NOT implement now): Structured imports (e.g. Jira)

Documented so the seams are respected today. The developer will **import** issues into
Plangent (not have the agent call Jira directly). An import fills `Task.description`
(and `Task.jira_url`). Because `buildPrompt` already injects `taskDescription`, an
agent-primed planning session can then plan straight from the imported description —
the developer may not need to type anything. No core/agent changes are needed per
source; a new source just populates `description`. Keep `description` injection intact.

---

## 6. Implementation task list (ordered)

Each step should leave the app working.

1. **Prompt:** add `RunContext.purpose` + planning branch in `buildPrompt`
   (`server/adapters/generic.ts`).
2. **Ingest:** `watchPlanDirForCreate` + first-plan `createPlan` + git-exclude
   (`server/services/plan-file.ts`).
3. **Launch:** wire `purpose` and the plan-file watch into `POST /runs`
   (`server/api/routes/runs.ts`).
4. **Create modal:** key+title only + uniqueness check (`HomeView.vue`).
5. **Tabs:** split `TaskView.vue` into "План" / "Выполнение"; move panels; remove
   quick-launch; global terminal dock stays.
6. **Planning UI:** empty-state actions, `launchPlanning()`, live `plan_updated`
   → `loadPlan()` when no plan yet.
7. **Typecheck:** `npx tsc --noEmit` on server and client.

---

## 7. Acceptance Criteria

1. Creating a task asks only for **key + title**; a duplicate key is rejected with a
   clear message. No `description` field in the modal.
2. The "План" tab shows an obvious way to create a plan: "Сделать с помощью агента"
   (primed planning session) **or** "Написать вручную".
3. "Сделать с помощью агента" launches an agent already primed for planning (it does
   not start executing code).
4. Describing the task in the terminal (with `@`-mentions / pasted files) makes the
   agent write `.plangent/<KEY>.plan.md`; the "План" tab fills in **live**, and
   `.plangent/` never appears in `git status`.
5. Telling the agent to rewrite the plan in the same session updates the steps in the UI.
6. Editing the plan manually in the editor saves to the DB.
7. The "Выполнение" tab owns point selection, queue building, run, and history; the
   old quick-launch block is gone.
8. Planning and execution never share one crowded surface; terminals are reachable
   from both tabs.
