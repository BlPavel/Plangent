import { ref, type Ref } from 'vue'
import { api } from '@core/api'
import type { RunStartResult } from '@core/models'
import type { NewChatRequest } from '@features/agent-chat'

export function useAgentChatLaunch(projectId: Ref<string | undefined>, taskId: Ref<string | undefined>, purpose: 'plan' | 'analysis') {
  const launching = ref(false), error = ref('')
  async function launch({ content, ...options }: NewChatRequest) {
    if (!projectId.value || !taskId.value || !options.agent_id || launching.value) return
    launching.value = true
    error.value = ''
    try {
      const result = await api.post<RunStartResult>(`/projects/${projectId.value}/tasks/${taskId.value}/runs`,
        { purpose, agent_id: options.agent_id, model: options.model || undefined, mode: options.mode, config: options.config })
      return { ...result, content }
    } catch (e) { error.value = String(e) }
    finally { launching.value = false }
  }
  return { launching, error, launch }
}
