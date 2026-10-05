# Server review lifecycle

The service is `reviews.ts`; `store.ts` handles persistence only. The HTTP base is
`/api/projects/:projectId/code-reviews`. All routes use the local-origin guard.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /current | Current branch review, other open reviews, agent warnings, file hashes and summary |
| GET | / | History with status, read_only, commit/round/item counts |
| POST | /items | Create a developer draft; create the current review atomically if needed |
| GET | /:reviewId | Saved items, snippets, rounds and agent chat events; read_only flag |
| GET | /:reviewId/file-items?path=...&side=new | Relocate snippets for the active review; historical anchors stay unchanged |
| GET | /:reviewId/diff?path=... | head_start ? current HEAD, another local branch tip, or saved head_end |
| PATCH | /:reviewId/items/:itemId | Edit draft text/refs/location; sent items are immutable through this route |
| DELETE | /:reviewId/items/:itemId | Remove an item from the active review |
| POST | /:reviewId/items/:itemId/general | Convert an outdated item into a general remark |
| PUT | /:reviewId/viewed | Mark/unmark a file using its server-computed hash |
| POST | /:reviewId/finish | Explicitly close; body mode is require_resolved (default), carry, or close |
| DELETE | /:reviewId | Delete a review and its exclusively owned agent chats |

Draft bodies contain scope, kind, text and optional file, line_start, line_end, side,
refs. Optional origin/origin_id select a project or a task in that project.
The server captures line snippets. Viewed bodies contain path and viewed (boolean).

Review identity is the project and local branch; detached identity additionally uses
the exact HEAD commit. Projects without Git use branch=null, head_commit='' and
head_start='': the empty non-null value is a reserved identity, never a Git revision.
Such projects accept only file/general remarks and have no viewed files or diff.

A commit never closes a review. Finish rejects a working agent and unresolved items
unless a disposition is supplied. carry atomically closes the old review and creates
a new review on the same branch with fresh drafts, preserved snippets and
carried_from_item_id. close marks pending items rejected, retaining their history.
done, answered and rejected are terminal; draft, sent and needs_decision are pending.

head_last retains the latest observed HEAD. Missing/renamed local branches are marked
abandoned with no closed_at until explicitly finished. Their diff uses the last
observed endpoint; commits never observed before branch deletion cannot be inferred.
Finalizing an abandoned review is allowed; carrying from it is blocked.

Hash changes permanently invalidate viewed marks until explicitly rechecked, including
a revert back to the previous bytes. Invalidated rows preserve the original hash.
Snippet matching normalizes CRLF, checks the old position first, then searches all
lines; a missing snippet retains its old location and sets outdated. Opening another
branch or historical review does not relocate its items.

Lifecycle mutations are serialized per project and repository identity is checked
again after asynchronous draft/hash reads. Round snapshots write unreachable Git
objects through an isolated temporary index; refs and the developer index stay intact.

## Code fixer rounds (p8)

POST /:reviewId/rounds accepts { session_id, note?, item_ids? }. Without item_ids the round
takes all drafts; with them only those items, which may also be answered questions (they
become fixes: sending is the developer's agreement) and needs_decision items (insisting).
A failed delivery restores each item's previous status, round and kind. Create a project chat with
POST /agent-sessions and role=code-fixer first; agent/model/mode/config selection uses
the existing session API. An existing chat is reusable only within the same review.
The server snapshots through the isolated Git index, atomically creates the round
and assigns all drafts, then sends the summary to the chat. Delivery failure restores
the drafts and removes the round. No-Git projects use an empty snapshot_tree.
starting/thinking/waiting review chats block sending and finishing. Project lifecycle
locks are shared by service instances, and branch identity is rechecked after capture.

The round message only announces the counts (plus the developer note); the items travel
through MCP. get_review returns protocol (how fixes and questions are resolved, built in),
assigned (this chat's items in status sent) and history (other sent items as context).
A new chat is titled «Доработка · ревью #N».

Code fixers receive only get_review and resolve_review_item(id, status, answer).
The session's project and round ownership constrain access; agents cannot reject
items or resolve drafts/another chat's items. answered applies only to questions.
A question can become done after a reply and a later developer chat message, with
the answer marked "по итогам обсуждения"; the instruction requires the agent to
verify explicit agreement before making the change.

POST /:reviewId/items/:itemId/decision accepts decision=agree (rejected) or
decision=insist (sent, plus "Сделай как в замечании" in the assigned chat).
GET /attention reports open reviews needing developer decisions.
code_review_updated events include projectId, reviewId, item, attention and unresolved;
code_review_needs_decision adds itemId and reason for notifications.

The hidden first-message briefing is the role line plus the developer's instruction (what
the agent may touch, how it reports). Instructions resolve project → group → global → built-in; code-fixer-instruction
library items are never exported into agent files. ACP denies git commands and edits
outside the physical project folder, including through external junctions/symlinks.
Deleting a chat clears round.session_id and preserves the review items; deleting
the review closes and deletes its owned chats.
