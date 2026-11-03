# Plan review

Public API: `createPlanReviewService` (injectable database) and `planReviews()`.
HTTP: `/api/projects/:projectId/tasks/:taskId/plan-reviews`.
The service checks project/task/review ownership. A new review snapshots the current persisted
plan and gets the next task-scoped round. Queue execution (running or paused) blocks creation.

Storage is split into reviews, remarks and thread messages; all foreign keys cascade on task deletion.
The reviewed text and coverage remain historical snapshots. References on cards are live:
the orchestration plan-saved event maps them simultaneously through idMap; deleted steps keep
a deleted flag. Affected cards receive an outdated flag, including changes in a step description.

Decisions: open / accepted / discussing / rejected. Discussing is with the reviewer (its chat answers in the card via answer_plan_remark); acceptance may carry a clarification,
discussion requires a comment, rejection may carry a reason. Comments are also stored in the thread.
After successful planner delivery, call sent with the exact ids and planner session:
accepted -> sent. A planner disagreement or question about an accepted card -> answered (the developer decides again).
Only a changed plan saved by the recipient planner applies sent accepted cards -> applied.
Other cards affected by the save retain their decisions and receive an outdated marker.
Applied cards keep the plan version recorded at that save. History is retained between rounds.

store.ts handles persistence; remarks.ts validates decisions and remaps references;
agent.ts exposes the reviewer protocol, brief, launcher and coverage validation; reviewer.ts implements the read-only session workflow.
planner.ts holds delivery/reply transitions; planner-transport.ts selects/resumes planners and delivers structured batches.
POST /launch accepts agent_id, model, reasoning_effort, skill_id and wish (defaults to the last choice, then the project agent).
POST /:id/send (no body needed) sends the accepted cards to the planner that wrote the plan if it is free, else to a new planner (agent_id optional); and only when every card is decided (none open, discussing or answered); session_id=null explicitly creates a new planner.
MCP scopes reviewer output to its review and planner replies to the delivered batch. Replies are stored in card threads.
Failed dispatch leaves cards and unsent messages unchanged. Review and dispatch reject running/paused queues.
The public module subscribes to orchestration/plan-events without a reverse import.
A card can be rewritten before it goes to the planner: by the reviewer after a discussion (MCP revise_plan_remark, only for cards
being discussed) or by the developer (PUT /:id/remarks/:rid/text). The first version stays in `original`.
The planner never sees threads: get_plan_review_items returns per card only id, steps, kind, text, suggestion and the developer's
clarification (the decision text of an accepted card), which wins over the text where they differ.

## Review of a material (architecture, QA)
A review has a target: `plan` (default) | `architecture` | `qa`; rounds are counted per target. `plan_version`/`plan_content` of a review hold the version and text of whatever is reviewed, read from `plans` or `materials`.
A card of a document points at identifiers (`D…`/`Q…`, in `steps`) and/or an exact `quote`; its kinds are `contradiction`, `coverage`, `extra`, `unclear`, `risk` and `suggestion` (an improvement, kept apart from violations). A document review has no coverage table.
`get_plan_review_brief` returns by the review's target: the plan with the analysis, or the document with its grounds (the analysis; for QA also the architecture marked ready), the material's review instruction and skill (`core/library/section-settings`).
Accepted cards go to the author of the same document type: the last `material-author` session of that type or a new one; it reads them with `get_plan_review_items` and replies with `reply_plan_remark`. The recipient is checked against the review's target.
`core/materials/events` (`material_saved`) outdates the cards of that document, marks vanished identifiers deleted and applies sent cards when the recipient saves the document. This module depends on `core/materials`, never the other way.
HTTP: the same paths; `?target=architecture|qa` selects the list, `/skills` and `/launch`, other paths belong to a review and know its target.
