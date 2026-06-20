import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import type { Project } from '@core/models'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    projects.value = await api.get<Project[]>('/projects')
    loading.value = false
  }

  async function create(data: Omit<Project, 'id' | 'created_at'>): Promise<Project> {
    const p = await api.post<Project>('/projects', data)
    projects.value.unshift(p)
    return p
  }

  async function update(id: string, data: Partial<Project>): Promise<Project> {
    const p = await api.patch<Project>(`/projects/${id}`, data)
    const idx = projects.value.findIndex(x => x.id === id)
    if (idx >= 0) projects.value[idx] = p
    return p
  }

  async function remove(id: string) {
    await api.delete(`/projects/${id}`)
    projects.value = projects.value.filter(x => x.id !== id)
  }

  return { projects, loading, load, create, update, remove }
})
