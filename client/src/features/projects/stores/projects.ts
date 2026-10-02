import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@core/api'
import type { Project } from '@core/models'

export type ProjectInput = Partial<Omit<Project, 'id' | 'created_at' | 'active_tasks'>> & { name: string }

// Groups, work projects and reference sources all come from /projects, told apart by `kind`.
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const loading = ref(false)

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

  return { projects, loading, groups, sources, workProjects, members, byId, agentFor, load, create, update, remove }
})
