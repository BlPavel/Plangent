import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { conflictsApi } from '../api'
import type { ConflictState } from '../git-types'

/** The merge/rebase the developer runs themselves, its conflicted files and the agent resolving them. */
export const useConflictsStore = defineStore('code-conflicts', () => {
  const projectId = ref(''), workspaceId = ref<string | undefined>(), state = ref<ConflictState | null>(null), busy = ref(false), error = ref('')
  const operation = computed(() => state.value?.operation ?? null)
  const conflicted = computed(() => state.value?.files.filter(f => f.conflicted) ?? [])
  const working = computed(() => ['starting', 'thinking', 'waiting'].includes(state.value?.session?.status ?? ''))
  /** The agent's questions still waiting for the developer. */
  const questions = computed(() => conflicted.value.filter(f => f.note?.outcome === 'question' && !f.note.answer_sent))
  /**
   * One main action at a time: `start` — conflicts nobody looked at (first run, next rebase stop); `working`;
   * `answer` — the agent asked; `done` — every conflict has the agent's note, only a redo is left.
   */
  const mode = computed<'start' | 'working' | 'answer' | 'done'>(() => {
    if (working.value) return 'working'
    if (questions.value.length) return 'answer'
    return conflicted.value.some(f => !f.note) ? 'start' : 'done'
  })
  let unsubscribe: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0

  async function refresh() {
    const p = projectId.value, token = ++generation
    if (!p) return
    try {
      const next = await conflictsApi.state(p, workspaceId.value)
      if (token === generation && p === projectId.value) state.value = next
    } catch { /* not a git project or the server is busy: keep the last known state */ }
  }
  async function start(p: string, workspace?: string) {
    stop()
    projectId.value = p; workspaceId.value = workspace; state.value = null; error.value = ''
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
  const resolve = (input: { note?: string; answers?: Record<string, string> } = {}) => act(() => conflictsApi.resolve(projectId.value, input, workspaceId.value))
  const stopAgent = () => act(async () => { await conflictsApi.stop(projectId.value, workspaceId.value); await refresh() })
  return { projectId, state, busy, error, operation, conflicted, working, questions, mode, start, stop, refresh, resolve, stopAgent }
})
