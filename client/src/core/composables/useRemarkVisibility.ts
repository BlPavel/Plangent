import { computed, ref, watch } from 'vue'
import { useRemarkVisibilityStore } from '../stores/remark-visibility'

export interface RemarkVisibilityEntry { id: string; closed: boolean }

/** Explicit navigation reveals one card locally, without changing the saved preference. */
export function useRemarkVisibility(owner: () => string, entries: () => RemarkVisibilityEntry[]) {
  const preference = useRemarkVisibilityStore()
  const revealed = ref(new Set<string>())
  const justClosed = ref(new Set<string>())
  watch(owner, () => { revealed.value.clear(); justClosed.value.clear() }, { flush: 'sync' })
  watch(() => ({ owner: owner(), entries: entries() }), (next, previous) => {
    if (!previous || next.owner !== previous.owner) return
    const before = new Map(previous.entries.map(item => [item.id, item.closed]))
    const current = new Set(next.entries.map(item => item.id))
    for (const item of next.entries) {
      if (item.closed && before.get(item.id) === false) {
        revealed.value.delete(item.id)
        justClosed.value.add(item.id)
      }
      if (!item.closed) justClosed.value.delete(item.id)
    }
    for (const ids of [revealed.value, justClosed.value]) for (const id of ids) if (!current.has(id)) ids.delete(id)
  })
  const visible = (id: string, closed: boolean) => !closed || preference.showClosed || revealed.value.has(id) || justClosed.value.has(id)
  const notice = (id: string, closed: boolean) => closed && !preference.showClosed && !revealed.value.has(id) && justClosed.value.has(id)
  const reveal = (id: string) => { revealed.value.add(id); justClosed.value.delete(id) }
  const hiddenCount = computed(() => preference.showClosed ? 0 : entries().filter(item => item.closed && !revealed.value.has(item.id)).length)
  return { preference, visible, notice, reveal, hiddenCount }
}
