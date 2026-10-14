<template>
  <div class="git-agent">
    <div class="ga-head">
      <span class="ga-label">Агент для коммитов и МР</span>
      <button v-if="own" type="button" class="ga-link" :title="'Вернуть ' + inheritedName" @click="reset">сбросить</button>
    </div>
    <div class="ga-row">
      <AppSelect :model-value="agentId" :options="agentOptions" size="sm" @update:model-value="setAgent" />
      <AppSelect v-if="agentId && models.length" :model-value="model" :options="[{ value: '', label: 'По умолчанию агента' }, ...models]" prefix="Модель" size="sm" @update:model-value="set('git_agent_model', $event)" />
      <AppSelect v-if="agentId && efforts.length" :model-value="effort" :options="[{ value: '', label: 'По умолчанию агента' }, ...efforts]" prefix="Рассуждения" size="sm" @update:model-value="set('git_agent_effort', $event)" />
    </div>
    <small class="ga-hint">
      Пишет сообщения коммитов («✨»), разбивает изменения в «Завершении работ» и готовит описание МР. Работает только на чтение: файлы и git он не меняет, коммиты делает Plangent.
      <template v-if="!own"> Сейчас: {{ inheritedName }}.</template>
    </small>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { ProjectGitSettings } from '@core/models'
import AppSelect from '@shared/ui/AppSelect.vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort } from '@features/agent-chat'

/** The git agent of a project, group or the whole app; empty agent — the level below decides (in the end the project's own agent). */
const props = defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; source?: string; fallback: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const agents = useAgentsStore(), chat = useChatStore()
if (!agents.agents.length) void agents.load()

const own = computed(() => Object.hasOwn(props.modelValue, 'git_agent_id'))
const agentId = computed(() => (own.value ? props.modelValue.git_agent_id : props.inherited.git_agent_id) ?? '')
const model = computed(() => (own.value ? props.modelValue.git_agent_model : props.inherited.git_agent_model) ?? '')
const effort = computed(() => (own.value ? props.modelValue.git_agent_effort : props.inherited.git_agent_effort) ?? '')
const nameOf = (id?: string) => agents.agents.find(a => a.id === id)?.name ?? id
const inheritedName = computed(() => {
  const id = props.inherited.git_agent_id
  if (!id) return props.fallback
  const where = props.source === 'group' ? 'из группы' : 'из глобальных настроек'
  return [nameOf(id), props.inherited.git_agent_model, props.inherited.git_agent_effort].filter(Boolean).join(' · ') + ' (' + where + ')'
})
const agentOptions = computed(() => [{ value: '', label: props.fallback }, ...agents.agents.map(a => ({ value: a.id, label: a.name }))])
watch(agentId, id => { if (id && !chat.agentOptions[id]) void chat.fetchAgentOptions(id) }, { immediate: true })
const reported = computed(() => modelAndEffort(chat.agentOptions[agentId.value]))
const models = computed(() => reported.value.models)
const efforts = computed(() => reported.value.efforts)

/** The three values travel together: a model belongs to the agent it was picked for. */
function setAgent(id: string) { emit('update:modelValue', { ...props.modelValue, git_agent_id: id, git_agent_model: '', git_agent_effort: '' }) }
function set(key: 'git_agent_model' | 'git_agent_effort', value: string) {
  emit('update:modelValue', { ...props.modelValue, git_agent_id: agentId.value, git_agent_model: model.value, git_agent_effort: effort.value, [key]: value })
}
function reset() {
  emit('update:modelValue', Object.fromEntries(Object.entries(props.modelValue).filter(([key]) => !key.startsWith('git_agent_'))))
}
</script>

<style scoped>
.git-agent { display: flex; flex-direction: column; gap: 6px; }
.ga-head { display: flex; align-items: center; gap: 8px; min-height: 18px; }
.ga-label { font-size: 12.5px; font-weight: 500; color: var(--text); }
.ga-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--text-faint); background: none; border: none; cursor: pointer; }
.ga-link:hover { color: var(--blue-hover); }
.ga-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ga-hint { font-size: 11px; line-height: 1.45; color: var(--text-faint); }
</style>
