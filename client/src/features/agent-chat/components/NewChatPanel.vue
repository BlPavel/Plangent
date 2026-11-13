<template>
  <div class="new-chat" :class="{ compact }">
    <div v-if="!compact" class="new-chat-center">
      <h2 class="new-chat-title">{{ title }}</h2>
      <p class="new-chat-text">{{ text }}</p>
      <div class="new-chat-options">
        <AppSelect v-model="agentId" :options="agentList" placeholder="Агент" block />
      </div>
    </div>
    <div class="new-chat-dock">
      <template v-if="compact">
        <div class="new-chat-row">
          <span class="new-chat-label">{{ title }}</span>
          <AppSelect v-model="agentId" :options="agentList" placeholder="Агент" size="sm" block />
          <slot name="actions" />
        </div>
        <p v-if="text" class="new-chat-hint">{{ text }}</p>
      </template>
      <ChatComposer v-if="!compact" :draft-key="draftKey!" :initial-text="initialText" :commands="commands" :project-id="projectId" :workspace-id="workspaceId" :placeholder="placeholder" :disabled="!agentId || busy" @send="start" @error="localError = $event">
        <template v-if="git" #tools>
          <AppButton type="button" variant="subtle" size="xs" :pressed="gitForTurn" title="Разрешить Git-действия на один ход" @click="gitForTurn = !gitForTurn">Git</AppButton>
        </template>
        <template #status><UsageMeter v-if="agentId" :agent-id="agentId" /></template>
      </ChatComposer>
      <AgentSettingsBar :policy="fixedPolicy ?? policy" :selects="resolvedSelects" :locked="!!fixedPolicy" @policy="policy = $event" @change="pick">
        <span v-if="optionsState === 'loading'" class="options-note">Загружаю модели агента…</span>
        <span v-else-if="optionsState" class="options-note" :title="optionsState">Не удалось получить настройки агента · <AppButton variant="link" size="xs" @click="retry">повторить</AppButton></span>
      </AgentSettingsBar>
      <!-- Compact: no message to write, the first message is `initialText` as is. -->
      <div v-if="compact" class="new-chat-foot">
        <UsageMeter v-if="agentId" :agent-id="agentId" />
        <AppButton class="new-chat-send" variant="blue" size="sm" :disabled="!agentId || busy" @click="start([{ type: 'text', text: initialText ?? '' }])">{{ busy ? 'Отправка…' : sendLabel || 'Начать' }}</AppButton>
      </div>
      <div v-if="error || localError" class="new-chat-error">{{ error || localError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAgentsStore, permissionPolicy } from '@features/agents'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppButton from '@shared/ui/AppButton.vue'
import ChatComposer, { type ContentBlock } from './ChatComposer.vue'
import UsageMeter from './UsageMeter.vue'
import AgentSettingsBar from './AgentSettingsBar.vue'
import { useAgentLaunchOptions } from '../composables/useAgentLaunchOptions'

/** What a new agent session starts with — the body of POST /agent-sessions (and of a planning run). */
export interface NewChatRequest {
  agent_id: string
  policy: import('@contracts').PermissionPolicy
  model: string
  mode: string
  config: Record<string, string>
  content: ContentBlock[]
}

/**
 * Start screen of an agent chat: agent, its limits, model/mode/reasoning and the first message.
 * `fixedPolicy` pins the permission policy (e.g. a planner is always read-only).
 */
const props = defineProps<({ compact: true; draftKey?: string } | { compact?: false; draftKey: string }) & {
  projectId: string
  workspaceId?: string | null
  draftKey?: string
  defaultAgentId?: string | null
  /** Model and reasoning preselected for the default agent (the agent's own settings otherwise). */
  defaultModel?: string
  defaultEffort?: string
  /** Permission policy preselected (the settings' choice for the review agent). */
  defaultPolicy?: string
  title: string
  text: string
  initialText?: string
  placeholder?: string
  fixedPolicy?: string
  busy?: boolean
  error?: string
  /** Only the dock (agent, message, settings) for a narrow side panel, without the chat start screen. */
  compact?: boolean
  /** The start button of the compact panel. */
  sendLabel?: string
  /** Offers «Git»: Git actions allowed for the first message. */
  git?: boolean
}>()
const emit = defineEmits<{ start: [request: NewChatRequest, gitForTurn: boolean] }>()
const gitForTurn = ref(false)
const agents = useAgentsStore()
const agentId = ref(''), policy = ref(props.defaultPolicy || 'ask'), localError = ref('')
const { resolvedSelects, commands, state: optionsState, launch, pick, retry } = useAgentLaunchOptions(agentId, () => ({ agentId: props.defaultAgentId, model: props.defaultModel, effort: props.defaultEffort }))

const agentList = computed(() => agents.agents.map(a => ({ value: a.id, label: a.name })))

const fallbackAgent = () => props.defaultAgentId || agents.agents[0]?.id || ''
watch(() => props.projectId, () => { agentId.value = fallbackAgent() }, { immediate: true })
watch(() => agents.agents.length, () => { if (!agentId.value) agentId.value = fallbackAgent() })
// The default may arrive late (settings are fetched); it replaces only a pick that is still the old default.
watch(() => props.defaultAgentId, (_, old) => { if (!agentId.value || agentId.value === (old || agents.agents[0]?.id)) agentId.value = fallbackAgent() })

function start(content: ContentBlock[]) {
  localError.value = ''
  emit('start', { agent_id: agentId.value, policy: permissionPolicy(props.fixedPolicy ?? policy.value), ...launch(), content }, !!props.git && gitForTurn.value)
}
</script>

<style scoped>
.new-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; height: 100%; }
.new-chat-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); padding: var(--sp-6); text-align: center; }
.new-chat-title { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.01em; }
.new-chat-text { font-size: var(--fs-md); color: var(--text-muted); max-width: 420px; }
.new-chat-options { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); margin-top: var(--sp-3); }
.new-chat-options .select.block { width: 220px; }
.new-chat-dock { width: 100%; max-width: 820px; margin: 0 auto; padding: 0 var(--sp-5) var(--sp-4); }
.options-note { font-size: var(--fs-sm); color: var(--text-faint); padding: 0 6px; white-space: nowrap; }
.new-chat.compact { flex: none; height: auto; }
.compact .new-chat-dock { max-width: none; padding: 8px 12px 10px; }
.new-chat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.new-chat-label { font-size: var(--fs-md); font-weight: 600; white-space: nowrap; }
.new-chat-row .select { flex: 1; min-width: 0; }
.new-chat-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.new-chat-send { margin-left: auto; }
.new-chat-hint { margin: 0 0 6px; font-size: var(--fs-sm); line-height: 1.4; color: var(--text-faint); }
.new-chat-error { margin-top: 6px; font-size: var(--fs-sm); color: var(--danger-hover); }
</style>
