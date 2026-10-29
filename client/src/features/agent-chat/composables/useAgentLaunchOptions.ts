import { computed, ref, watch, type Ref } from 'vue'
import { useAgentsStore } from '@features/agents'
import { agentSelects, type AgentSelect } from '../utils/agent-options'
import { useChatStore } from '../stores/sessions'

/**
 * The agent's own models, modes and reasoning levels for a session about to start, and the developer's picks.
 * Until something is picked, a select shows what Plangent applies on start: mode «default», the model and
 * reasoning depth from the agent's settings, else the agent's own default.
 */
export function useAgentLaunchOptions(agentId: Ref<string>) {
  const store = useChatStore(), agents = useAgentsStore()
  const choices = ref<Record<string, string>>({})
  // The agent reports its own options; the first fetch opens a throwaway session (a few seconds).
  const reported = computed(() => store.agentOptions[agentId.value])
  const selects = computed(() => (reported.value && !('error' in reported.value) ? agentSelects(reported.value) : []))
  /** '' — ready (or no agent), 'loading', else the error text. */
  const state = computed(() => (!agentId.value ? '' : !reported.value ? 'loading' : 'error' in reported.value ? reported.value.error : ''))
  function choice(select: AgentSelect) {
    if (choices.value[select.configId]) return choices.value[select.configId]
    const offered = (v: string | undefined) => !!v && select.options.some(o => o.value === v)
    if (select.kind === 'mode') return ['default', 'read-only'].find(offered) ?? select.current
    const agent = agents.agents.find(a => a.id === agentId.value)
    if (select.kind === 'model' && offered(agent?.model)) return agent!.model
    if (select.category === 'thought_level' && offered(agent?.reasoning_effort)) return agent!.reasoning_effort
    return select.current
  }
  const resolvedSelects = computed(() => selects.value.map(s => ({ ...s, current: choice(s) })))
  watch(agentId, id => { choices.value = {}; if (id && !store.agentOptions[id]) void store.fetchAgentOptions(id) }, { immediate: true })

  /** What the session starts with: model and mode always (the server would otherwise apply its defaults), config only when chosen. */
  function launch() {
    const modelSelect = selects.value.find(s => s.kind === 'model'), modeSelect = selects.value.find(s => s.kind === 'mode')
    return {
      model: modelSelect ? choice(modelSelect) : '',
      mode: modeSelect ? choice(modeSelect) : '',
      config: Object.fromEntries(selects.value.filter(s => s.kind === 'config' && (s.configId in choices.value || choice(s) !== s.current)).map(s => [s.configId, choice(s)])),
    }
  }
  const pick = (select: AgentSelect, value: string) => { choices.value[select.configId] = value }
  const retry = () => store.fetchAgentOptions(agentId.value, true)
  return { resolvedSelects, state, launch, pick, retry }
}
