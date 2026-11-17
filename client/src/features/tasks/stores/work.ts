import { ref } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { onWorkEvent, onWorkspaceEvent } from '../events'
import type { WorkEntry } from '@contracts'
import { workApi } from '../api'
import { isClosing, setClosing } from '../composables/useWorkActions'

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
      if (mine === version) {
        entries.value = lists.flat(); error.value = ''
        for (const entry of entries.value) if (entry.task.closed_at && isClosing(entry.task.id)) setClosing(entry.task.id, false)
      }
    } catch (cause) { if (mine === version) error.value = String(cause) }
    finally { if (mine === version) loading.value = false }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
  const relevant = (projectId?: string) => !projectId || projects.includes(projectId)
  onWorkEvent(event => { if (relevant(event.projectId)) soon() })
  onWorkspaceEvent(event => { if (relevant(event.projectId)) soon() })
  onServerEvent(event => { if (event.type === 'task_updated' || event.type === 'events:connected') soon() })
  // A task's Завершение that went through closes the work on the server (see docs/server/git.md): show it closing meanwhile.
  onServerEvent<{ type: string; run?: { task_id: string | null; status: string }; taskId?: string; title?: string }>(event => {
    if (event.type === 'finish:changed' && event.run?.task_id && event.run.status === 'complete') setClosing(event.run.task_id, true)
    if (event.type === 'finish:notification' && event.taskId && event.title === 'Ошибка закрытия работы') setClosing(event.taskId, false)
  })
  return { entries, loading, error, load }
})
