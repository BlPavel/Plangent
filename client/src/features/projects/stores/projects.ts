import { defineStore } from 'pinia'
import { computed, ref, onScopeDispose } from 'vue'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import type { SyncProgress } from '@core/models/integrations'
import type { Project } from '@core/models'

export type ProjectInput = Partial<Omit<Project, 'id' | 'created_at' | 'active_tasks'>> & { name: string }

// Groups, work projects and reference sources all come from /projects, told apart by `kind`.
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const loading = ref(false)
  const syncProgress = ref<Record<string, SyncProgress>>({})
  const unsubscribe = onServerEvent<{ type: string; project_id?: string; project?: Project; progress?: SyncProgress }>(event => {
    if (!event.project_id) return
    if (event.type === 'docs-sync-progress' && event.progress) syncProgress.value[event.project_id] = event.progress
    if (event.type === 'docs-sync-status') {
      if (event.project) { const i = projects.value.findIndex(p => p.id === event.project_id); if (i >= 0) projects.value[i] = event.project }
      else { const p = byId(event.project_id); if (p) p.sync_status = 'running' }
      if (event.project?.sync_status !== 'running') delete syncProgress.value[event.project_id]
    }
  })
  onScopeDispose(unsubscribe)

  const groups = computed(() => projects.value.filter(p => p.kind === 'group'))
  const sources = computed(() => projects.value.filter(p => p.kind === 'source'))
  const workProjects = computed(() => projects.value.filter(p => p.kind === 'project'))
  const members = (groupId: string) => workProjects.value.filter(p => p.group_id === groupId)
  const byId = (id: string | null | undefined) => projects.value.find(p => p.id === id) ?? null
  // A project without its own default agent uses its group's.
  const agentFor = (p: Project | null | undefined) => p?.default_agent_id ?? byId(p?.group_id)?.default_agent_id ?? null

  async function load() {
    loading.value = true
    try { projects.value = await api.get<Project[]>('/projects') }
    finally { loading.value = false }
  }

  // Reloaded after a change: a project joining a group, for one, changes what the group shows.
  async function create(data: ProjectInput): Promise<Project> {
    const p = await api.post<Project>('/projects', data)
    await load()
    return byId(p.id) ?? p
  }

  async function update(id: string, data: Partial<Project>): Promise<Project> {
    const p = await api.patch<Project>(`/projects/${id}`, data)
    await load()
    return byId(id) ?? p
  }

  async function remove(id: string) {
    await api.delete(`/projects/${id}`)
    await load()
  }

  async function startSync(id: string, confirmedLarge = false) { await api.post('/projects/' + id + '/docs/sync', { confirmed_large: confirmedLarge }); await load() }
  async function cancelSync(id: string) { await api.post('/projects/' + id + '/docs/cancel'); await load() }

  return { syncProgress, startSync, cancelSync, projects, loading, groups, sources, workProjects, members, byId, agentFor, load, create, update, remove }
})
