
import { tasksEndpoints } from '../api'
import { ref, type Ref } from 'vue'

import type { NewChatRequest } from '@features/agent-chat'

export function useAgentChatLaunch(projectId: Ref<string | undefined>, taskId: Ref<string | undefined>, purpose: 'plan' | 'analysis' | 'architecture' | 'qa') {
  const launching = ref(false), error = ref('')
  async function launch({ content, ...options }: NewChatRequest) {
    if (!projectId.value || !taskId.value || !options.agent_id || launching.value) return
    launching.value = true
    error.value = ''
    try {
      const result = await tasksEndpoints.postProjectsByProjectIdTasksByTaskIdRuns({ params: { projectId: projectId.value, taskId: taskId.value }, body: { purpose, agent_id: options.agent_id, model: options.model || undefined, mode: options.mode, config: options.config } })
      return { session_id: result.session_id, mode: result.mode, content }
    } catch (e) { error.value = String(e) }
    finally { launching.value = false }
  }
  return { launching, error, launch }
}
