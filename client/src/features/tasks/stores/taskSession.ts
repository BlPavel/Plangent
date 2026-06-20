import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { OrchestratorQueueSession } from '@core/models'

export interface TaskTermSession { id: string; label: string; runId: string }

const STORAGE_KEY = 'plangent.taskSession.snapshots'

// A snapshot of a TaskView's live terminal/planning state, kept per task so it
// survives navigating away and back. The server keeps the PTY/tmux process alive
// when the websocket closes (see server/terminal/pty-manager.ts), so restoring this
// snapshot re-attaches the terminal and replays its buffer — the agent is never lost.
export interface TaskSessionSnapshot {
  sessions: TaskTermSession[]
  activeSessionId: string | null
  queueSessions: OrchestratorQueueSession[]
  waitingSessionIds: string[]
  sessionActivityByRunId?: Record<string, string>
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
      return JSON.parse(raw) as Record<string, TaskSessionSnapshot>
    } catch {
      return {}
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
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
