
import { libraryEndpoints } from '../api'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { onServerEvent } from '@core/api/events'
import type { LibraryItem, LibraryItemType, LibraryProposal, LibraryScope } from '@contracts'

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
      items.value = await libraryEndpoints.getLibrary({ params: {}, query: Object.fromEntries(new URLSearchParams(qs)) })
    } finally {
      loading.value = false
    }
  }

  async function getItem(id: string): Promise<LibraryItem> {
    return libraryEndpoints.getLibraryById({ params: { id: id } })
  }

  // Returns the id of the existing main file for the scope, or null
  async function findMainId(scope: LibraryScope, projectId?: string): Promise<string | null> {
    const params = new URLSearchParams({ type: 'main', scope })
    if (scope === 'project' && projectId) params.set('projectId', projectId)
    const list = await libraryEndpoints.getLibrary({ params: {  }, query: Object.fromEntries(new URLSearchParams(params.toString())) })
    return list[0]?.id ?? null
  }

  async function create(data: Partial<LibraryItem> & { type: LibraryItemType; slug: string; title: string; scope: LibraryScope; content?: string }): Promise<LibraryItem> {
    const item = await libraryEndpoints.postLibrary({ params: {  }, body: data })
    items.value.push(item)
    return item
  }

  async function update(id: string, data: Partial<LibraryItem> & { content?: string }): Promise<LibraryItem> {
    const item = await libraryEndpoints.putLibraryById({ params: { id: id }, body: data })
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) items.value[idx] = item
    return item
  }

  async function remove(id: string): Promise<void> {
    await libraryEndpoints.deleteLibraryById({ params: { id: id } })
    items.value = items.value.filter(i => i.id !== id)
  }

  // A group's item changed or removed inside one project: that project gets its own copy / nothing, the group keeps its item.
  const detach = (id: string, projectId: string) => libraryEndpoints.postLibraryByIdDetach({ params: { id: id }, body: { projectId } })
  const exclude = (id: string, projectId: string) => libraryEndpoints.postLibraryByIdExclude({ params: { id: id }, body: { projectId } })

  async function syncAll(): Promise<void> {
    await libraryEndpoints.postLibrarySync({ params: {  } })
  }

  async function getPlanTemplateDefaults(): Promise<{ lockedProtocol: string }> {
    return libraryEndpoints.getLibraryPlanTemplateDefaults({ params: {  } })
  }

  async function getOverride(id: string, agentType: string): Promise<string | null> {
    const r = await libraryEndpoints.getLibraryByIdOverridesByAgentType({ params: { id: id, agentType: agentType } })
    return r.content
  }

  async function setOverride(id: string, agentType: string, content: string): Promise<void> {
    await libraryEndpoints.putLibraryByIdOverridesByAgentType({ params: { id: id, agentType: agentType }, body: { content } })
  }

  async function deleteOverride(id: string, agentType: string): Promise<void> {
    await libraryEndpoints.deleteLibraryByIdOverridesByAgentType({ params: { id: id, agentType: agentType } })
  }

  // ── Librarian proposals: loaded per project, kept fresh by server events ──
  const proposals = ref<Record<string, LibraryProposal>>({})
  let unsubscribe: (() => void) | undefined

  function putProposal(p: LibraryProposal) { proposals.value[p.id] = p }

  async function loadProposals(projectId: string): Promise<void> {
    for (const p of await libraryEndpoints.getLibraryProposals({ params: {  }, query: Object.fromEntries(new URLSearchParams("projectId=" + encodeURIComponent(projectId))) })) putProposal(p)
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
    return libraryEndpoints.postLibraryProposalsByProposalIdApply({ params: { proposalId: id }, body: availability ? { availability } : {} })
  }

  async function rejectProposal(id: string): Promise<void> {
    putProposal(await libraryEndpoints.postLibraryProposalsByProposalIdReject({ params: { proposalId: id } }))
  }

  async function getInstructionGuideDefault(): Promise<string> {
    return (await libraryEndpoints.getLibraryInstructionGuideDefaults({ params: {  } })).content
  }

  async function getCodeFixerInstructionDefault(): Promise<string> {
    return (await libraryEndpoints.getLibraryCodeFixerInstructionDefaults({ params: {  } })).content
  }

  return {
    items, loading, load, getItem, findMainId, create, update, remove, syncAll, detach, exclude, getPlanTemplateDefaults, getOverride, setOverride, deleteOverride,
    proposals, loadProposals, proposalsFor, applyProposal, rejectProposal, getInstructionGuideDefault, getCodeFixerInstructionDefault,
  }
})
