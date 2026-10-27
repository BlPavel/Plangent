<template>
  <div class="review-settings">
    <label><span>Агент</span><AppSelect :model-value="session.agentId" :options="agentOptions" size="sm" @update:model-value="patch({ agentId: $event, model: undefined, reasoningEffort: undefined })" /></label>
    <label v-if="choices.models.length"><span>Модель</span><AppSelect :model-value="session.model ?? agent?.model ?? ''" :options="choices.models" size="sm" @update:model-value="patch({ model: $event })" /></label>
    <label v-if="choices.efforts.length"><span>Рассуждения</span><AppSelect :model-value="session.reasoningEffort ?? agent?.reasoning_effort ?? ''" :options="choices.efforts" size="sm" @update:model-value="patch({ reasoningEffort: $event })" /></label>
    <label><span>Скилл ревью</span><AppSelect :model-value="currentSkill" :options="skillOptions" size="sm" @update:model-value="patch({ skillId: $event || undefined })" /></label>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { Agent, OrchestratorQueueSession } from '@core/models'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import AppSelect from '@shared/ui/AppSelect.vue'
import { TaskQueueKey } from '../composables/useTaskQueue'

const props = defineProps<{ session: OrchestratorQueueSession; agents: Agent[] }>()
const queue = inject(TaskQueueKey)!
const app = useAppStore(), chats = useChatStore()
const agent = computed(() => props.agents.find(a => a.id === props.session.agentId))
const agentOptions = computed(() => props.agents.map(a => ({ value: a.id, label: a.name })))
const choices = computed(() => modelAndEffort(chats.agentOptions[props.session.agentId]))
const skills = ref<{ id: string; title: string; origin: string }[]>([])
const origin: Record<string, string> = { direct: 'проект', group: 'группа', global: 'общий' }
const skillOptions = computed(() => skills.value.length
  ? skills.value.map(s => ({ value: s.id, label: `${s.title} · ${origin[s.origin] ?? s.origin}` }))
  : [{ value: '', label: 'Стандартный' }])
const currentSkill = computed(() => skills.value.find(s => s.id === props.session.skillId)?.id ?? skills.value[0]?.id ?? '')
watch(() => props.session.agentId, id => { if (id && !chats.agentOptions[id]) void chats.fetchAgentOptions(id) }, { immediate: true })
watch(() => queue.queue.value?.projectId, async (id, _old, cleanup) => {
  let stale = false
  cleanup(() => { stale = true })
  if (!id) return
  try {
    const result = await api.get<typeof skills.value>(`/projects/${id}/branch-review/skills`)
    if (!stale) skills.value = result
  } catch (e) { if (!stale) app.toast(String(e), 'error') }
}, { immediate: true })
function patch(value: Partial<OrchestratorQueueSession>) { void queue.updateSession(props.session.id, value) }
</script>

<style scoped>
.review-settings { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin-left: 16px; padding-top: 8px; border-top: 1px solid var(--border); cursor: default; }
.review-settings label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); }
.review-settings :deep(.select) { width: 100%; }
</style>
