import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import type { LibraryItem, LibraryItemType, LibraryProposal, LibraryScope } from '@core/models'

export const useLibraryStore = defineStore('library', () => {
  const items = ref<LibraryItem[]>([])
  const loading = ref(false)

  // forProject: everything that applies to that project/group, each item with its `origin`.
  async function load(filters: { type?: LibraryItemType; scope?: LibraryScope; projectId?: string; forProject?: string } = {}) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (filters.type) params.set('type', filters.type)
      if (filters.scope) params.set('scope', filters.scope)
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.forProject) params.set('forProject', filters.forProject)
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

  // A group's item changed or removed inside one project: that project gets its own copy / nothing, the group keeps its item.
  const detach = (id: string, projectId: string) => api.post<LibraryItem>(`/library/${id}/detach`, { projectId })
  const exclude = (id: string, projectId: string) => api.post(`/library/${id}/exclude`, { projectId })

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

  // ── Librarian proposals: loaded per project, kept fresh by server events ──
  const proposals = ref<Record<string, LibraryProposal>>({})
  let unsubscribe: (() => void) | undefined

  function putProposal(p: LibraryProposal) { proposals.value[p.id] = p }

  async function loadProposals(projectId: string): Promise<void> {
    for (const p of await api.get<LibraryProposal[]>(`/library/proposals?projectId=${encodeURIComponent(projectId)}`)) putProposal(p)
    unsubscribe ??= onServerEvent<{ type: string; proposal?: LibraryProposal }>(event => {
      if (event.type === 'library_proposal' && event.proposal) putProposal(event.proposal)
    })
  }

  function proposalsFor(filter: { projectId?: string; sessionId?: string }): LibraryProposal[] {
    return Object.values(proposals.value)
      .filter(p => (!filter.projectId || p.project_id === filter.projectId) && (!filter.sessionId || p.session_id === filter.sessionId))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  // A conflict (stale snapshot, taken slug) comes back as an error; the new status arrives as an event.
  async function applyProposal(id: string, availability?: { scope: LibraryScope; targets: string[]; own_only: string[] }): Promise<LibraryItem> {
    return api.post<LibraryItem>(`/library/proposals/${id}/apply`, availability ? { availability } : {})
  }

  async function rejectProposal(id: string): Promise<void> {
    putProposal(await api.post<LibraryProposal>(`/library/proposals/${id}/reject`))
  }

  async function getInstructionGuideDefault(): Promise<string> {
    return (await api.get<{ content: string }>('/library/instruction-guide/defaults')).content
  }

  async function getCodeFixerInstructionDefault(): Promise<string> {
    return (await api.get<{ content: string }>('/library/code-fixer-instruction/defaults')).content
  }

  return {
    items, loading, load, getItem, findMainId, create, update, remove, syncAll, detach, exclude, getPlanTemplateDefaults, getOverride, setOverride, deleteOverride,
    proposals, loadProposals, proposalsFor, applyProposal, rejectProposal, getInstructionGuideDefault, getCodeFixerInstructionDefault,
  }
})
