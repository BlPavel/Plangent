# Drafts

Keep unsaved text in the in-memory `core/stores/drafts` store so navigating or
unmounting a view preserves it. Use `useDraft` from `@core/composables/useDraft`:

```ts
const draft = useDraft(() => `task:${props.taskId}:reply`, () => ({ text: '' }))
```

The key identifies the owner and purpose: include project, task, session, workspace
or code location as appropriate. Supply a getter so a reused component follows
its current owner. Keep text, attachments and mentions together. ChatComposer
requires a stable `draftKey`; late initial text must preserve deliberately edited
or erased input. Selection state belongs to its own store.

Clear the current draft after a successful send/save or explicit cancel. Failed
requests retain it. Delete an owner's drafts with `clear`/`clearPrefix` only after
successful deletion; include a trailing delimiter in prefixes to protect siblings.
Drafts survive view remounts for this app session; they do not persist across reloads.

Code drags use the `MentionDrag` format exported by agent-chat. The composer
resolves the exact path with the mentions API in its project and workspace,
inserts `@path`, `@folder/` or `@path:start-end` at the current selection, and
stores the returned URI with the draft's mentions. Sending keeps line numbers
in the text and emits a resource link to the file itself. Disk-file drops stay
attachments. A response arriving after the owner or text changes is ignored.

Use `useDocumentDraft` for document editing: retain the version editing began
against, show StaleDraftNote when the source changes, and reload only after the
user chooses “Взять актуальный”.

Verify with `npm run test:drafts-ui` and `npm run test:chat-ui` (remounts, owner
switches, late sources, stale documents, failed actions and cleanup).
