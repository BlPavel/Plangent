import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import type { Agent } from '@core/models'

export const useAgentsStore = defineStore('agents', () => {
  const agents = ref<Agent[]>([])

  async function load() {
    agents.value = await api.get<Agent[]>('/agents')
  }

  async function create(data: Omit<Agent, 'id' | 'created_at' | 'active'>): Promise<Agent> {
    const a = await api.post<Agent>('/agents', data)
    agents.value.push(a)
    return a
  }

  async function update(id: string, data: Partial<Agent>): Promise<Agent> {
    const a = await api.patch<Agent>(`/agents/${id}`, data)
    const idx = agents.value.findIndex(x => x.id === id)
    if (idx >= 0) agents.value[idx] = a
    return a
  }

  async function remove(id: string) {
    await api.delete(`/agents/${id}`)
    agents.value = agents.value.filter(x => x.id !== id)
  }

  return { agents, load, create, update, remove }
})
