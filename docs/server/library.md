# Instructions and skills

`common/library-registry.ts` is the shared executable registry. It describes
section IDs separately for global and project editors, their target types,
labels, allowed scopes, text types and per-level uniqueness. Client and server
import it directly; it has no server dependencies or built-in text. A group's
editor uses project scope. Global plan review targets `plan-review-instruction`;
project plan review targets `plan-review-skill`.

`core/library/operations.ts` owns saves, deletes, exclusions, detached project
copies and agent overrides. HTTP handlers and proposal application call these
operations. Availability and uniqueness are validated before mutation. Saves
remove the previous installation, write metadata/content and synchronize the new
installation. A detached copy preserves metadata and overrides, excludes the
group item from that project, and leaves other projects unchanged.
The detach endpoint accepts optional `changes`: manual editing creates and saves
the copy in this single operation, rather than detaching and updating separately.

Operations combine a synchronous database transaction with the file journal in
`file-transaction.ts`. Content, overrides, installed files, managed main-file
sections and Git exclude files touched by synchronization are recorded before
mutation. Failed writes, synchronization or database commits roll back metadata
and restore file bytes. Restoration failures are reported alongside the original
error. This compensates synchronous failures; it is not a crash recovery log.
`library_changed` is emitted after successful commit. Proposal conflict checks
and status changes remain in `proposals.ts`; its callback sets `applied` in the
save transaction after synchronization, before commit. Failed saves stay pending.

Existing content paths remain readable. New writes to main files and text
instructions (except commit rules, already keyed by ID) use
`data/library/texts/<item-id>/`. This prevents equal fixed slugs at different
levels from overwriting one another. Legacy shared content is retained while
other items still reference it. Existing skills, commands and overrides retain
their paths. Identity changes and detached copies transfer agent overrides
through the same file journal.

`instructionTextState(type, scope, projectId?)` returns effective text/source,
the current level's own item (including disabled items), built-in text and
inherited text/source. `section-settings.ts` owns the shared selection rules:
available enabled direct item, group item, global item, then built-in text.
Global scope ignores the code-context project. Global-only types reject project
scope. The plan template has a built-in text like the other templates; a saved
empty plan template is a valid result and disables it.

`GET /api/library/instruction-text` exposes this state. The editor loads it in
one request, reloads on `library_changed`, rejects late responses after owner
changes and retains drafts by scope/project/type with their original text.
An external source change marks a dirty draft stale instead of replacing it.

Proposal `base_content` remains the diff base. The editable item's `snapshot`
remains independent and detects item conflicts. New text proposals also retain
`instruction_snapshot`, the effective text/source at creation, to detect changes
to inherited or built-in instructions. Older proposal records remain readable
without this optional snapshot. Section metadata is supplied on every librarian
turn and retained when continuing in a new context; proposals of unrelated types
are rejected using the shared registry.

Only ordinary skills, commands and main sections are installed in agent
directories. Internal Plangent texts and review skills retain their existing
runtime consumers; built-in texts and file synchronization stay on the server.
