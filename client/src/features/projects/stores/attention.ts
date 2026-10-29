import { ref } from 'vue'
import { defineStore } from 'pinia'
import { onWorkEvent, onServerEvent } from '@core/api/events'
import { workApi } from '@features/tasks'

/** How many works of each project wait for the developer; shown as a badge in the project tree, also for other projects. */
export const useWorkAttentionStore = defineStore('work-attention', () => {
  const counts = ref<Record<string, number>>({})
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    try { counts.value = Object.fromEntries((await workApi.attention()).map(row => [row.projectId, row.count])) }
    catch { /* the badge is a hint: keep the last numbers */ }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 300) }
  onWorkEvent(soon)
  onServerEvent(event => { if (event.type === 'events:connected' || event.type === 'task_updated') soon() })
  const countFor = (projectId: string) => counts.value[projectId] ?? 0
  return { counts, load, countFor }
})
