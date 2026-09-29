import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'

export interface BlockedQueue { projectId: string; taskId: string; taskKey: string; reason: string }

/**
 * Executing queues of every project that wait for the developer (paused, a question, a permission
 * request). Refreshed whenever a queue or an agent chat changes.
 */
export const useBlockedQueuesStore = defineStore('blockedQueues', () => {
  const items = ref<BlockedQueue[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = false

  async function load() {
    try { items.value = await api.get<BlockedQueue[]>('/queues/blocked') } catch { /* keep the last known state */ }
  }

  function start() {
    if (started) return
    started = true
    void load()
    onServerEvent(event => {
      if (event.type !== 'queue_updated' && event.type !== 'agent_session') return
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 300)
    })
  }

  const forProject = (projectId: string) => items.value.filter(i => i.projectId === projectId)

  return { items, start, forProject }
})
