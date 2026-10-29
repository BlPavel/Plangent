import { ref } from 'vue'
import { defineStore } from 'pinia'
import { onWorkEvent, onWorkspaceEvent, onServerEvent } from '@core/api/events'
import type { WorkEntry } from '@core/models'
import { workApi } from '../api'

/** Work list of the open project (a group page also lists its members' work). Refreshed on server events. */
export const useWorkStore = defineStore('work', () => {
  const entries = ref<WorkEntry[]>([]), loading = ref(false), error = ref('')
  let projects: string[] = [], version = 0, timer: ReturnType<typeof setTimeout> | undefined

  async function load(ids: string[] = projects) {
    projects = ids
    const mine = ++version
    if (!ids.length) { entries.value = []; return }
    loading.value = true
    try {
      const lists = await Promise.all(ids.map(id => workApi.list(id)))
      if (mine === version) { entries.value = lists.flat(); error.value = '' }
    } catch (cause) { if (mine === version) error.value = String(cause) }
    finally { if (mine === version) loading.value = false }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
  const relevant = (projectId?: string) => !projectId || projects.includes(projectId)
  onWorkEvent(event => { if (relevant(event.projectId)) soon() })
  onWorkspaceEvent(event => { if (relevant(event.projectId)) soon() })
  onServerEvent(event => { if (event.type === 'task_updated' || event.type === 'events:connected') soon() })
  return { entries, loading, error, load }
})
