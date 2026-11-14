import { defineStore } from 'pinia'
import { ref } from 'vue'
import { agentsApi } from '../api'
import type { Agent } from '@contracts'

export const useAgentsStore = defineStore('agents', () => {
  const agents = ref<Agent[]>([])

  async function load() {
    agents.value = await agentsApi.list({ params: {} })
  }

  async function create(data: Omit<Agent, 'id' | 'created_at' | 'active'>): Promise<Agent> {
    const a = await agentsApi.create({ params: {}, body: data })
    agents.value.push(a)
    return a
  }

  async function update(id: string, data: Partial<Agent>): Promise<Agent> {
    const a = await agentsApi.update({ params: { id }, body: data })
    const idx = agents.value.findIndex(x => x.id === id)
    if (idx >= 0) agents.value[idx] = a
    return a
  }

  async function remove(id: string) {
    await agentsApi.remove({ params: { id } })
    agents.value = agents.value.filter(x => x.id !== id)
  }

  return { agents, load, create, update, remove }
})
