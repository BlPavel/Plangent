import { computed } from 'vue'
import { useDraftsStore } from '../stores/drafts'

/** Resolve on every access: a reused component follows its current entity. */
export function useDraft<T>(key: () => string, factory: () => T) {
  const store = useDraftsStore()
  return computed<T>({
    get: () => store.get(key(), factory),
    set: value => { store.drafts[key()] = value },
  })
}

/** Manual document edits retain the source version until explicitly reloaded. */
export function useDocumentDraft(key: () => string, source: () => { text: string; version: number }) {
  const draft = useDraft(key, () => ({ active: false, text: '', version: 0 }))
  const active = computed({ get: () => draft.value.active, set: value => { draft.value.active = value } })
  const text = computed({ get: () => draft.value.text, set: value => { draft.value.text = value } })
  const stale = computed(() => active.value && draft.value.version !== source().version)
  function reload() { Object.assign(draft.value, source()) }
  function start() { if (!active.value) reload(); active.value = true }
  function cancel() { draft.value = { active: false, text: '', version: 0 } }
  return { active, text, stale, start, reload, cancel }
}
