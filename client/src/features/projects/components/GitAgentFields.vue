<template>
  <div class="git-agent">
    <div class="ga-head">
      <span class="ga-label">{{ kind === 'review' ? 'Агент для ревью и правок' : kind === 'conflict' ? 'Агент для конфликтов' : 'Агент для коммитов и МР' }}</span>
      <AppButton v-if="own" variant="link" size="xs" :title="'Вернуть ' + inheritedName" @click="reset">сбросить</AppButton>
    </div>
    <div class="ga-row">
      <AppSelect :model-value="agentId" :options="agentOptions" :popup-max-width="220" size="sm" @update:model-value="setAgent" />
      <AppSelect v-if="agentId && models.length" :model-value="model" :options="[{ value: '', label: 'По умолчанию агента' }, ...models]" prefix="Модель" :popup-max-width="220" size="sm" @update:model-value="set('model', $event)" />
      <AppSelect v-if="agentId && efforts.length" :model-value="effort" :options="[{ value: '', label: 'По умолчанию агента' }, ...efforts]" prefix="Рассуждения" :popup-max-width="220" size="sm" @update:model-value="set('effort', $event)" />
      <AppSelect v-if="kind === 'review' && agentId" :model-value="policy" :options="policyOptions" :heading="POLICY_HEADING" prefix="Разрешения" :popup-max-width="220" size="sm" @update:model-value="setPolicy" />
    </div>
    <small class="ga-hint">
      <template v-if="kind === 'review'">Разбирает МР и ветки на вкладке «Ревью»: пишет сводку и черновики замечаний, отвечает на вопросы по коду. Там он работает только на чтение. Во вкладке «Код» он выполняет ваши замечания; «Разрешения» — что ему можно без вопросов (опасные команды спрашиваются всегда). git он не меняет.</template>
      <template v-else-if="kind === 'conflict'">Разрешает конфликты merge и rebase, которые вы запустили сами («Разрешить с агентом» во вкладке «Код»). Правит только конфликтные файлы; add, continue и abort делаете вы. Здесь нужна модель посильнее.</template>
      <template v-else>Пишет сообщения коммитов («✨»), разбивает изменения в «Завершении работ» и готовит описание МР. Работает только на чтение: файлы и git он не меняет, коммиты делает Plangent.</template>
      <template v-if="!own"> Сейчас: {{ inheritedName }}.</template>
    </small>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { ProjectGitSettings } from '@contracts'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort, POLICIES, POLICY_HEADING } from '@features/agent-chat'

/** The git agent of a project, group or the whole app; empty agent — the level below decides (in the end the project's own agent). */
const props = withDefaults(defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; source?: string; fallback: string; kind?: 'git' | 'review' | 'conflict' }>(), { kind: 'git', source: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const agents = useAgentsStore(), chat = useChatStore()
if (!agents.agents.length) void agents.load()

const keys = computed(() => ({ id: `${props.kind}_agent_id`, model: `${props.kind}_agent_model`, effort: `${props.kind}_agent_effort` }) as { id: 'git_agent_id'; model: 'git_agent_model'; effort: 'git_agent_effort' })
const own = computed(() => Object.hasOwn(props.modelValue, keys.value.id))
const pick = (key: 'id' | 'model' | 'effort') => (own.value ? props.modelValue[keys.value[key]] : props.inherited[keys.value[key]]) ?? ''
const agentId = computed(() => pick('id'))
const model = computed(() => pick('model'))
const effort = computed(() => pick('effort'))
const nameOf = (id?: string) => agents.agents.find(a => a.id === id)?.name ?? id
const inheritedName = computed(() => {
  const id = props.inherited[keys.value.id]
  if (!id) return props.fallback
  const where = props.source === 'group' ? 'из группы' : 'из глобальных настроек'
  return [nameOf(id), props.inherited[keys.value.model], props.inherited[keys.value.effort]].filter(Boolean).join(' · ') + ' (' + where + ')'
})
/** What the review agent may do in the Код tab without asking; the empty value is the built-in choice. */
const policy = computed(() => (own.value ? props.modelValue.review_agent_policy : props.inherited.review_agent_policy) ?? '')
const policyOptions = [{ value: '', label: 'По умолчанию: разрешать правки' }, ...POLICIES.filter(o => o.value !== 'read-only')]
const agentOptions = computed(() => [{ value: '', label: props.fallback }, ...agents.agents.map(a => ({ value: a.id, label: a.name }))])
watch(agentId, id => { if (id && !chat.agentOptions[id]) void chat.fetchAgentOptions(id) }, { immediate: true })
const reported = computed(() => modelAndEffort(chat.agentOptions[agentId.value]))
const models = computed(() => reported.value.models)
const efforts = computed(() => reported.value.efforts)

/** The three values travel together: a model belongs to the agent it was picked for. */
function setAgent(id: string) { emit('update:modelValue', { ...props.modelValue, [keys.value.id]: id, [keys.value.model]: '', [keys.value.effort]: '' }) }
function set(key: 'model' | 'effort', value: string) {
  emit('update:modelValue', { ...props.modelValue, [keys.value.id]: agentId.value, [keys.value.model]: model.value, [keys.value.effort]: effort.value, [keys.value[key]]: value })
}
function setPolicy(value: string) {
  emit('update:modelValue', { ...props.modelValue, review_agent_id: agentId.value, review_agent_model: model.value, review_agent_effort: effort.value, review_agent_policy: value })
}
function reset() {
  emit('update:modelValue', Object.fromEntries(Object.entries(props.modelValue).filter(([key]) => !key.startsWith(props.kind + '_agent_'))))
}
</script>

<style scoped>
.git-agent { display: flex; flex-direction: column; gap: 6px; }
.ga-head { display: flex; align-items: center; gap: 8px; min-height: 18px; }
.ga-label { font-size: var(--fs-md); font-weight: 500; color: var(--text); }
.ga-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ga-hint { font-size: var(--fs-xs); line-height: 1.45; color: var(--text-faint); }
</style>
