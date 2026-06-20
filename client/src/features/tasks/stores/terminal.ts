import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface TerminalSession {
  id: string
  label: string
  projectId: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const sessions = ref<TerminalSession[]>([])
  const activeSessionId = ref<string | null>(null)

  function sessionsForProject(projectId: string) {
    return computed(() => sessions.value.filter(s => s.projectId === projectId))
  }

  function addSession(s: TerminalSession) {
    sessions.value.push(s)
    activeSessionId.value = s.id
  }

  function removeSession(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[sessions.value.length - 1]?.id ?? null
    }
  }

  function setActive(id: string | null) {
    activeSessionId.value = id
  }

  return { sessions, activeSessionId, sessionsForProject, addSession, removeSession, setActive }
})
