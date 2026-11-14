import { defineStore } from 'pinia'
import { ref } from 'vue'

/** In-memory unsaved input, scoped to the entity that owns it. */
export const useDraftsStore = defineStore('drafts', () => {
  const drafts = ref<Record<string, unknown>>({})
  function get<T>(key: string, factory: () => T): T {
    if (!Object.prototype.hasOwnProperty.call(drafts.value, key)) drafts.value[key] = factory()
    return drafts.value[key] as T
  }
  function clear(key: string) { delete drafts.value[key] }
  function clearPrefix(prefix: string) {
    for (const key of Object.keys(drafts.value)) if (key.startsWith(prefix)) clear(key)
  }
  return { drafts, get, clear, clearPrefix }
})
