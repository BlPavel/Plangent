import { reactive } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'plangent.taskSession.snapshots'

// Which analysis/planning chat a task shows, kept per task so it survives navigating away and back.
// The chats themselves live on the server (agent sessions of the task, see useChatStore);
// the execution queue too — see features/tasks/composables/useTaskQueue.
// A selected chat of `null` means "new chat"; `undefined` means "the latest one".
export interface TaskSessionSnapshot {
  selectedAnalysisChat?: string | null
  planningOpen: boolean
  selectedPlanningChat?: string | null
}

export const useTaskSessionStore = defineStore('taskSession', () => {
  const snapshots = reactive<Record<string, TaskSessionSnapshot>>(loadSnapshots())

  function loadSnapshots(): Record<string, TaskSessionSnapshot> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const all = JSON.parse(raw) as Record<string, TaskSessionSnapshot & { planningActive?: boolean; planningSessionId?: string | null }>
      // Older snapshots kept the chat lists and a single planner session: keep only the selection.
      return Object.fromEntries(Object.entries(all).map(([id, s]) => [id, {
        selectedAnalysisChat: s.selectedAnalysisChat ?? undefined,
        planningOpen: !!(s.planningOpen ?? s.planningActive),
        selectedPlanningChat: s.selectedPlanningChat ?? s.planningSessionId ?? undefined,
      }]))
    } catch {
      return {}
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots)) } catch { /* storage unavailable */ }
  }

  function save(taskId: string, snap: TaskSessionSnapshot) {
    snapshots[taskId] = snap
    persist()
  }

  function load(taskId: string): TaskSessionSnapshot | undefined {
    return snapshots[taskId]
  }

  function clear(taskId: string) {
    delete snapshots[taskId]
    persist()
  }

  return { snapshots, save, load, clear }
})
