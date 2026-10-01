import { reactive } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'plangent.taskSession.snapshots'

// The planning session of a task, kept per task so it survives navigating away and back:
// the planner keeps running on the server and the task re-attaches to its chat.
// (The execution queue lives on the server — see features/tasks/composables/useTaskQueue.)
export interface AnalysisChatSnapshot { runId: string; sessionId: string }

export interface TaskSessionSnapshot {
  analysisChats?: AnalysisChatSnapshot[]
  selectedAnalysisChat?: string | null
  planningActive: boolean
  planningRunId: string | null
  planningSessionId: string | null
}

export const useTaskSessionStore = defineStore('taskSession', () => {
  const snapshots = reactive<Record<string, TaskSessionSnapshot>>(loadSnapshots())

  function loadSnapshots(): Record<string, TaskSessionSnapshot> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const all = JSON.parse(raw) as Record<string, TaskSessionSnapshot>
      // Older snapshots also carried terminal and queue state: keep only the planning part.
      return Object.fromEntries(Object.entries(all).map(([id, s]) => [id, {
        analysisChats: s.analysisChats ?? [],
        selectedAnalysisChat: s.selectedAnalysisChat ?? s.analysisChats?.at(-1)?.sessionId ?? null,
        planningActive: !!s.planningActive,
        planningRunId: s.planningRunId ?? null,
        planningSessionId: s.planningSessionId ?? null,
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
