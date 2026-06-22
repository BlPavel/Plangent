import { reactive } from 'vue'
import { defineStore } from 'pinia'

export interface TaskTermSession { id: string; label: string; runId: string }

// A snapshot of a TaskView's live terminal/planning state, kept per task so it
// survives navigating away and back. The server keeps the PTY/tmux process alive
// when the websocket closes (see server/terminal/pty-manager.ts), so restoring this
// snapshot re-attaches the terminal and replays its buffer — the agent is never lost.
export interface TaskSessionSnapshot {
  sessions: TaskTermSession[]
  activeSessionId: string | null
  waitingSessionIds: string[]
  planningActive: boolean
  planningRunId: string | null
  planningSessionId: string | null
}

export const useTaskSessionStore = defineStore('taskSession', () => {
  const snapshots = reactive<Record<string, TaskSessionSnapshot>>({})

  function save(taskId: string, snap: TaskSessionSnapshot) {
    snapshots[taskId] = snap
  }

  function load(taskId: string): TaskSessionSnapshot | undefined {
    return snapshots[taskId]
  }

  function clear(taskId: string) {
    delete snapshots[taskId]
  }

  return { snapshots, save, load, clear }
})
