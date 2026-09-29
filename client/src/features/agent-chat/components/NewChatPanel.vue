<template>
  <div class="new-chat">
    <div class="new-chat-center">
      <h2 class="new-chat-title">{{ title }}</h2>
      <p class="new-chat-text">{{ text }}</p>
      <div class="new-chat-options">
        <AppSelect v-model="agentId" :options="agentList" placeholder="Агент" />
      </div>
    </div>
    <div class="new-chat-dock">
      <ChatComposer :project-id="projectId" :placeholder="placeholder" :disabled="!agentId || busy" @send="start" @error="localError = $event">
        <template #status><UsageMeter v-if="agentId" :agent-id="agentId" /></template>
      </ChatComposer>
      <AgentSettingsBar :policy="fixedPolicy ?? policy" :selects="resolvedSelects" :locked="!!fixedPolicy" @policy="policy = $event" @change="(select, value) => (choices[select.configId] = value)">
        <span v-if="optionsState === 'loading'" class="options-note">Загружаю модели агента…</span>
        <span v-else-if="optionsState" class="options-note" :title="optionsState">Не удалось получить настройки агента · <button type="button" @click="store.fetchAgentOptions(agentId, true)">повторить</button></span>
      </AgentSettingsBar>
      <div v-if="error || localError" class="new-chat-error">{{ error || localError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAgentsStore } from '@features/agents'
import AppSelect from '@shared/ui/AppSelect.vue'
import ChatComposer, { type ContentBlock } from './ChatComposer.vue'
import UsageMeter from './UsageMeter.vue'
import AgentSettingsBar from './AgentSettingsBar.vue'
import { agentSelects, type AgentSelect } from '../utils/agent-options'
import { useChatStore } from '../stores/sessions'

/** What a new agent session starts with — the body of POST /agent-sessions (and of a planning run). */
export interface NewChatRequest {
  agent_id: string
  policy: string
  model: string
  mode: string
  config: Record<string, string>
  content: ContentBlock[]
}

/**
 * Start screen of an agent chat: agent, its limits, model/mode/reasoning and the first message.
 * `fixedPolicy` pins the permission policy (e.g. a planner is always read-only).
 */
const props = defineProps<{
  projectId: string
  defaultAgentId?: string | null
  title: string
  text: string
  placeholder?: string
  fixedPolicy?: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ start: [request: NewChatRequest] }>()
const store = useChatStore(), agents = useAgentsStore()
const agentId = ref(''), policy = ref('ask'), localError = ref('')
const choices = ref<Record<string, string>>({})

const agentList = computed(() => agents.agents.map(a => ({ value: a.id, label: a.name })))
// The agent reports its own models/modes/levels; the first fetch opens a throwaway session (a few seconds).
const reported = computed(() => store.agentOptions[agentId.value])
const selects = computed(() => (reported.value && !('error' in reported.value) ? agentSelects(reported.value) : []))
const optionsState = computed(() => (!agentId.value ? '' : !reported.value ? 'loading' : 'error' in reported.value ? reported.value.error : ''))
/** What the chat will start with: the user's pick, else what Plangent applies on start (mode: "default"), else the agent's default. */
const resolvedSelects = computed(() => selects.value.map(s => ({ ...s, current: choice(s) })))
function choice(select: AgentSelect) {
  if (choices.value[select.configId]) return choices.value[select.configId]
  if (select.kind === 'mode') return ['default', 'read-only'].find(v => select.options.some(o => o.value === v)) ?? select.current
  return select.current
}

const fallbackAgent = () => props.defaultAgentId || agents.agents[0]?.id || ''
watch(() => props.projectId, () => { agentId.value = fallbackAgent() }, { immediate: true })
watch(() => agents.agents.length, () => { if (!agentId.value) agentId.value = fallbackAgent() })
watch(agentId, id => { choices.value = {}; if (id && !store.agentOptions[id]) void store.fetchAgentOptions(id) }, { immediate: true })

function start(content: ContentBlock[]) {
  localError.value = ''
  const modelSelect = selects.value.find(s => s.kind === 'model'), modeSelect = selects.value.find(s => s.kind === 'mode')
  emit('start', {
    agent_id: agentId.value,
    policy: props.fixedPolicy ?? policy.value,
    model: modelSelect && choice(modelSelect) !== modelSelect.current ? choice(modelSelect) : '',
    mode: modeSelect ? choice(modeSelect) : '',
    config: Object.fromEntries(selects.value.filter(s => s.kind === 'config' && choice(s) !== s.current).map(s => [s.configId, choice(s)])),
    content,
  })
}
</script>

<style scoped>
.new-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
.new-chat-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); padding: var(--sp-6); text-align: center; }
.new-chat-title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.new-chat-text { font-size: 13px; color: var(--text-muted); max-width: 420px; }
.new-chat-options { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); margin-top: var(--sp-3); }
.new-chat-options .select { min-width: 200px; }
.new-chat-dock { width: 100%; max-width: 820px; margin: 0 auto; padding: 0 var(--sp-5) var(--sp-4); }
.options-note { font-size: 12px; color: var(--text-faint); padding: 0 6px; white-space: nowrap; }
.options-note button { background: none; border: none; padding: 0; color: var(--blue-hover); font: inherit; cursor: pointer; }
.new-chat-error { margin-top: 6px; font-size: 12px; color: var(--danger-hover); }
</style>
