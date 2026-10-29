import { ref } from 'vue'
import { defineStore } from 'pinia'
import { onWorkspaceEvent } from '@core/api/events'
import type { Workspace } from '@core/models'
import { workspacesApi } from '@features/tasks'

/** The workspace of the open project that Терминал and «Код» currently show; null — the main place. */
export const useViewingStore = defineStore('viewing', () => {
  const workspace = ref<Workspace | null>(null)
  let projectId = '', version = 0

  async function load(id: string | null | undefined) {
    projectId = id ?? ''
    const mine = ++version
    if (!id) { workspace.value = null; return }
    workspace.value = null
    try {
      const current = await workspacesApi.viewing(id)
      if (mine === version) workspace.value = current
    } catch { /* the bar is optional: without it the main place is shown */ }
  }
  onWorkspaceEvent(event => {
    if (event.type !== 'workspace:viewing' || event.projectId !== projectId) return
    version++
    workspace.value = event.workspace
  })
  // A removed workspace can no longer be viewed.
  onWorkspaceEvent(event => {
    if (event.type === 'workspace:update' && event.projectId === projectId && workspace.value?.id === event.workspace?.id && event.workspace?.status !== 'ready') workspace.value = null
  })
  return { workspace, load }
})
