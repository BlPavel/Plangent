import { computed, watch, type Ref } from 'vue'
import { useChatStore, type NewChatRequest } from '@features/agent-chat'
import { useAgentsStore } from '@features/agents'
import { useBranchReviewStore } from '../stores/review'
import type { AgentPick } from '../types'

/**
 * The one agent session of an open review (questions, the analysis and the round check all go to it).
 * It belongs to the reviewed head: after new commits the agent has to be chosen again.
 */
export function useReviewAgent(screenKey: string, head: Ref<string>) {
  const screen = useBranchReviewStore().of(screenKey)
  const chats = useChatStore(), agents = useAgentsStore()
  void chats.connect()
  const active = computed(() => screen.thread && screen.thread.head === head.value ? screen.thread.session_id : '')
  const session = computed(() => chats.sessions.find(s => s.id === active.value) ?? null)
  watch(active, id => { if (id && !chats.snapshots[id]) void chats.load(id).catch(() => undefined) }, { immediate: true })
  const busy = computed(() => ['starting', 'thinking'].includes(session.value?.status ?? ''))
  const agentName = computed(() => agents.agents.find(a => a.id === session.value?.agent_id)?.name ?? 'Агент')
  return { screen, active, session, busy, agentName }
}
export const pickOf = (request?: NewChatRequest): AgentPick | undefined => request && { agent_id: request.agent_id, model: request.model, mode: request.mode, config: request.config }
