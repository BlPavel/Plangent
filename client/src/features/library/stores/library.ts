import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import type { LibraryItem, LibraryItemType, LibraryScope } from '@core/models'

export const useLibraryStore = defineStore('library', () => {
  const items = ref<LibraryItem[]>([])
  const loading = ref(false)

  async function load(filters: { type?: LibraryItemType; scope?: LibraryScope; projectId?: string } = {}) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (filters.type) params.set('type', filters.type)
      if (filters.scope) params.set('scope', filters.scope)
      if (filters.projectId) params.set('projectId', filters.projectId)
      const qs = params.toString()
      items.value = await api.get<LibraryItem[]>(`/library${qs ? '?' + qs : ''}`)
    } finally {
      loading.value = false
    }
  }

  async function getItem(id: string): Promise<LibraryItem> {
    return api.get<LibraryItem>(`/library/${id}`)
  }

  // Returns the id of the existing main file for the scope, or null
  async function findMainId(scope: LibraryScope, projectId?: string): Promise<string | null> {
    const params = new URLSearchParams({ type: 'main', scope })
    if (scope === 'project' && projectId) params.set('projectId', projectId)
    const list = await api.get<LibraryItem[]>(`/library?${params.toString()}`)
    return list[0]?.id ?? null
  }

  async function create(data: Partial<LibraryItem> & { type: LibraryItemType; slug: string; title: string; scope: LibraryScope; content?: string }): Promise<LibraryItem> {
    const item = await api.post<LibraryItem>('/library', data)
    items.value.push(item)
    return item
  }

  async function update(id: string, data: Partial<LibraryItem> & { content?: string }): Promise<LibraryItem> {
    const item = await api.put<LibraryItem>(`/library/${id}`, data)
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) items.value[idx] = item
    return item
  }

  async function remove(id: string): Promise<void> {
    await api.delete(`/library/${id}`)
    items.value = items.value.filter(i => i.id !== id)
  }

  async function syncAll(): Promise<void> {
    await api.post('/library/sync')
  }

  async function getPlanTemplateDefaults(): Promise<{ lockedProtocol: string }> {
    return api.get<{ lockedProtocol: string }>('/library/plan-template/defaults')
  }

  async function getOverride(id: string, agentType: string): Promise<string | null> {
    const r = await api.get<{ content: string | null }>(`/library/${id}/overrides/${agentType}`)
    return r.content
  }

  async function setOverride(id: string, agentType: string, content: string): Promise<void> {
    await api.put(`/library/${id}/overrides/${agentType}`, { content })
  }

  async function deleteOverride(id: string, agentType: string): Promise<void> {
    await api.delete(`/library/${id}/overrides/${agentType}`)
  }

  return { items, loading, load, getItem, findMainId, create, update, remove, syncAll, getPlanTemplateDefaults, getOverride, setOverride, deleteOverride }
})
