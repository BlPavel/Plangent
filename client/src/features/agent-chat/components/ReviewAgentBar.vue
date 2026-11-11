<template>
  <div class="rab">
    <div class="rab-line">
      <span class="rab-label" :class="{ expanded }">{{ expanded ? 'Другой агент' : label || 'Агент ревью' }}</span>
      <span v-if="expanded" class="rab-spacer" />
      <span v-else class="rab-value" :title="summary">{{ summary || 'Загрузка…' }}</span>
      <UsageMeter v-if="agentId" :agent-id="agentId" placement="below" />
      <AppButton v-if="touched" variant="link" size="xs" :disabled="disabled" title="Вернуть агента из настроек проекта" @click="reset">сбросить</AppButton>
      <AppButton v-if="!expanded" variant="link" size="xs" :disabled="disabled" :aria-expanded="editing" @click="editing = !editing">{{ editing ? 'Готово' : 'Изменить' }}</AppButton>
    </div>
    <div v-if="editing || expanded" class="rab-edit">
      <AppSelect class="rab-sel" :model-value="agentId" :options="agentList" :popup-max-width="220" block size="sm" label="Агент" @update:model-value="setAgent" />
      <AppSelect class="rab-sel" v-if="modelSelect" :model-value="modelSelect.current" :options="modelSelect.options" :heading="modelSelect.heading" prefix="Модель" :popup-max-width="220" block size="sm" @update:model-value="change(modelSelect, $event)" />
      <AppSelect class="rab-sel" v-if="effortSelect" :model-value="effortSelect.current" :options="effortSelect.options" :heading="effortSelect.heading" prefix="Рассуждения" :popup-max-width="220" block size="sm" @update:model-value="change(effortSelect, $event)" />
      <AppSelect class="rab-sel" v-if="!readOnly" :model-value="policy" :options="policyOptions" :heading="POLICY_HEADING" prefix="Права" :popup-max-width="220" block size="sm" @update:model-value="setPolicy" />
      <span v-if="optionsState === 'loading'" class="rab-note">Загружаю модели агента…</span>
      <span v-else-if="optionsState" class="rab-note" :title="optionsState">Не удалось получить настройки агента · <AppButton variant="link" size="xs" @click="retry">повторить</AppButton></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useReviewAgentChoice } from '@features/projects'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import UsageMeter from './UsageMeter.vue'
import { useAgentLaunchOptions } from '../composables/useAgentLaunchOptions'
import { POLICIES, POLICY_HEADING, type AgentSelect } from '../utils/agent-options'

/** What the review agent starts with: the agent and its launch settings (the mode and config are the agent's own ids). */
export interface ReviewAgentPick { agent_id: string; model: string; mode: string; config: Record<string, string>; effort: string; policy: string }

/**
 * The agent of a review: the project's review agent from the settings, shown as one line (agent, model, reasoning, limits)
 * with «Изменить» for this review only. Only what the settings hold can be picked here.
 */
const props = defineProps<{ projectId: string; fallbackAgentId?: string | null; disabled?: boolean; /** The review only reads (a merge request): no permissions to choose. */ readOnly?: boolean; /** The settings stay open as a form: no summary line and no «Изменить». */ expanded?: boolean; /** What the line calls the agent. */ label?: string }>()
const emit = defineEmits<{ change: [pick: ReviewAgentPick] }>()
const agents = useAgentsStore()
if (!agents.agents.length) void agents.load()
const { choice: configured, loaded } = useReviewAgentChoice(() => props.projectId)
const agentId = ref(''), editing = ref(false), touched = ref(false)
/** Permissions: the settings' choice, else «Разрешать правки» — a review agent should not ask for every edit. */
const policyPick = ref<string | null>(null)
const policy = computed(() => policyPick.value ?? (configured.value?.policy || 'allow-edits'))
const policyOptions = POLICIES.filter(o => o.value !== 'read-only')
const defaultAgent = () => configured.value?.agentId || props.fallbackAgentId || agents.agents[0]?.id || ''
const { resolvedSelects, state: optionsState, launch, pick, retry } = useAgentLaunchOptions(agentId, () => ({ agentId: configured.value?.agentId, model: configured.value?.model, effort: configured.value?.effort }))

// Until the settings are known the agent is not chosen: a late answer must not replace a pick.
watch([loaded, () => agents.agents.length], () => { if (loaded.value && !touched.value && !agentId.value) agentId.value = defaultAgent() }, { immediate: true })
watch(() => props.projectId, () => { agentId.value = ''; touched.value = false; policyPick.value = null; editing.value = false })

const agentList = computed(() => agents.agents.map(a => ({ value: a.id, label: a.name })))
const modelSelect = computed(() => resolvedSelects.value.find(s => s.kind === 'model'))
const effortSelect = computed(() => resolvedSelects.value.find(s => s.category === 'thought_level'))
const labelOf = (select: AgentSelect | undefined, fallback = '') => select?.options.find(o => o.value === select.current)?.label ?? fallback
const summary = computed(() => {
  if (!agentId.value) return ''
  const own = configured.value?.agentId === agentId.value ? configured.value : null
  return [
    agents.agents.find(a => a.id === agentId.value)?.name ?? agentId.value,
    labelOf(modelSelect.value, own?.model),
    effortSelect.value ? 'рассуждения ' + labelOf(effortSelect.value, own?.effort).toLowerCase() : '',
    props.readOnly ? 'только чтение' : policyOptions.find(o => o.value === policy.value)?.label.toLowerCase(),
  ].filter(Boolean).join(' · ')
})

function setAgent(id: string) { agentId.value = id; touched.value = true }
function setPolicy(value: string) { policyPick.value = value; touched.value = true }
function change(select: AgentSelect, value: string) { pick(select, value); touched.value = true }
async function reset() {
  // The picks live with the agent: leaving and returning to it clears them.
  agentId.value = ''
  touched.value = false
  policyPick.value = null
  await nextTick()
  agentId.value = defaultAgent()
}

// This picker exposes permissions, not sandbox modes; the server selects a compatible mode.
watch([agentId, resolvedSelects, policy], () => {
  if (agentId.value) emit('change', { agent_id: agentId.value, ...launch(), mode: '', effort: effortSelect.value?.current ?? '', policy: props.readOnly ? 'read-only' : policy.value })
}, { immediate: true })
</script>

<style scoped>
.rab { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rab-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* Same size and line height as the value next to it, so both sit on one line. */
.rab-label { flex-shrink: 0; white-space: nowrap; font-size: var(--fs-sm); line-height: var(--lh-normal); color: var(--text-faint); }
.rab-label.expanded { font-size: var(--fs-md); font-weight: var(--fw-medium); color: var(--text); }
.rab-spacer { flex: 1; }
.rab-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); font-weight: var(--fw-medium); line-height: var(--lh-normal); color: var(--text); }
/* Two per row when they fit: the selects share the width instead of each taking a line. */
.rab-edit { display: flex; flex-wrap: wrap; gap: 6px; }
.rab-sel { flex: 1 1 130px; min-width: 0; }
.rab-note { flex: 1 1 100%; font-size: var(--fs-xs); color: var(--text-faint); }
</style>
