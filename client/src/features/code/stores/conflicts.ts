import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { conflictsApi } from '../api'
import type { ConflictState } from '../git-types'

/** The merge/rebase the developer runs themselves, its conflicted files and the agent resolving them. */
export const useConflictsStore = defineStore('code-conflicts', () => {
  const projectId = ref(''), state = ref<ConflictState | null>(null), busy = ref(false), error = ref('')
  const operation = computed(() => state.value?.operation ?? null)
  const conflicted = computed(() => state.value?.files.filter(f => f.conflicted) ?? [])
  const working = computed(() => ['starting', 'thinking', 'waiting'].includes(state.value?.session?.status ?? ''))
  /** Answers typed but not yet sent to the agent. */
  const pendingAnswers = computed(() => state.value?.files.filter(f => f.note?.answer && !f.note.answer_sent).length ?? 0)
  let unsubscribe: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0

  async function refresh() {
    const p = projectId.value, token = ++generation
    if (!p) return
    try {
      const next = await conflictsApi.state(p)
      if (token === generation && p === projectId.value) state.value = next
    } catch { /* not a git project or the server is busy: keep the last known state */ }
  }
  async function start(p: string) {
    stop()
    projectId.value = p; state.value = null; error.value = ''
    unsubscribe = onServerEvent<{ type: string; projectId?: string; session?: { id: string } }>(event => {
      const mine = event.type === 'conflicts:changed' && event.projectId === projectId.value
      const agent = event.type === 'agent_session' && event.session?.id === state.value?.session?.id
      if (mine || agent || event.type === 'code:changed' || event.type === 'events:connected') {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 200)
      }
    })
    await refresh()
  }
  function stop() { unsubscribe?.(); unsubscribe = undefined; clearTimeout(timer); generation++; projectId.value = '' }
  async function act(action: () => Promise<ConflictState | unknown>) {
    const p = projectId.value
    busy.value = true; error.value = ''
    try {
      const result = await action()
      if (p === projectId.value && result && typeof result === 'object' && 'files' in result) state.value = result as ConflictState
    } catch (cause) { if (p === projectId.value) error.value = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '') }
    finally { if (p === projectId.value) busy.value = false }
  }
  const resolve = (note?: string) => act(() => conflictsApi.resolve(projectId.value, note))
  const answer = (path: string, text: string) => act(() => conflictsApi.answer(projectId.value, path, text))
  const stopAgent = () => act(async () => { await conflictsApi.stop(projectId.value); await refresh() })
  return { projectId, state, busy, error, operation, conflicted, working, pendingAnswers, start, stop, refresh, resolve, answer, stopAgent }
})
