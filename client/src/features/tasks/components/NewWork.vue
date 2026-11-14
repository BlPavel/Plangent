<template>
  <form class="nw" @submit.prevent="submit">
    <div class="nw-head">
      <AppSegmented :model-value="kind" :options="[{ value: 'errand', label: '⚡ Поручение' }, { value: 'task', label: '📋 Задача с планом' }]" label="Что создать" @update:model-value="kind = $event as 'errand' | 'task'" />
      <span class="nw-hint">{{ kind === 'errand' ? 'Сразу к делу, без анализа и плана. Подробности напишете агенту в чате.' : 'Анализ, план и очередь шагов.' }}</span>
    </div>
    <div class="nw-box">
      <div class="nw-fields">
        <AppInput v-model="number" class="nw-number" mono placeholder="Номер задачи" aria-label="Номер задачи" maxlength="100" :disabled="busy" />
        <AppInput
          v-model="title" class="nw-title" block aria-label="Описание" maxlength="300" :disabled="busy"
          :placeholder="kind === 'errand' ? 'Что нужно сделать? Например: поправить вёрстку в профиле' : 'Описание задачи'"
        />
      </div>
      <div class="nw-bar">
        <template v-if="kind === 'errand'">
          <AppSelect v-model="agentId" :options="agentList" size="sm" variant="subtle" heading="Агент, который выполнит поручение" placeholder="Агент" />
          <AgentSettingsBar class="nw-settings" placement="bottom" :policy="policy" :selects="resolvedSelects" @policy="policy = $event" @change="pick">
            <span v-if="optionsState === 'loading'" class="nw-note">Загружаю модели агента…</span>
            <span v-else-if="optionsState" class="nw-note" :title="optionsState">Нет настроек агента · <AppButton variant="link" size="xs" @click="retry">повторить</AppButton></span>
          </AgentSettingsBar>
        </template>
        <FormField v-else-if="isGroup && members.length" v-model="owner" type="select" class="nw-owner" aria-label="Где">
          <option value="">🗂️ Вся группа</option>
          <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
        </FormField>
        <!-- The branch is chosen the same way for an errand and a task with a plan; a task chooses its review when the execution starts. -->
        <div class="nw-send">
          <WhereToWork ref="where" v-model="place" :project-id="project.id" :ordinary="!isGroup" :taken="taken" />
          <AppSwitch v-if="kind === 'errand'" v-model="review" :title="review ? 'После выполнения агент-ревьюер проверит изменения' : 'Без автоматического ревью агентом'">Ревью</AppSwitch>
          <AppButton type="submit" variant="blue" size="sm" :disabled="!canSubmit">{{ busy ? 'Создаю…' : kind === 'errand' ? '⚡ Поручить' : 'Создать задачу' }}</AppButton>
        </div>
      </div>
      <div v-if="kind === 'errand' && review && !isGroup" class="nw-review">
        <ReviewAgentBar label="Агент ревью" read-only :project-id="project.id" :fallback-agent-id="defaultAgentId" @change="reviewPick = $event" />
      </div>
    </div>
    <p v-if="error" class="nw-error" role="alert">{{ error }}</p>
  </form>
</template>
<script setup lang="ts">
import AppInput from '@shared/ui/AppInput.vue'
import { AppSegmented, AppSwitch } from '@shared/ui'

import { useDraft } from '@core/composables/useDraft'
import { computed, ref, watch } from 'vue'
import type { Agent, Project, Task } from '@contracts'
import { AgentSettingsBar, ReviewAgentBar, useAgentLaunchOptions, type ReviewAgentPick } from '@features/agent-chat'
import { gitApi } from '@features/code'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import FormField from '@shared/ui/FormField.vue'
import { workApi } from '../api'
import { useWorkStore } from '../stores/work'
import WhereToWork, { type WorkPlace } from './WhereToWork.vue'

const props = defineProps<{ project: Project; members: Project[]; agents: Agent[]; defaultAgentId?: string | null }>()
const emit = defineEmits<{ created: [task: Task, tab: string] }>()
const work = useWorkStore()
const isGroup = computed(() => props.project.kind === 'group')
const kind = ref<'errand' | 'task'>(localStorage.getItem('work.newKind') === 'task' ? 'task' : 'errand')
watch(kind, value => localStorage.setItem('work.newKind', value))
const number = useDraft(() => `project:${props.project.id}:new-work:number`, () => ''), title = useDraft(() => `project:${props.project.id}:new-work:title`, () => ''), owner = useDraft(() => `project:${props.project.id}:new-work:owner`, () => ''), busy = ref(false), error = ref('')

// Errand: who does it and how — chosen every time, starting from the project's agent and its own settings.
const agentId = ref(''), policy = ref('allow-all'), review = ref(false)
/** Who reviews the errand: the project's review agent from the settings until the developer changes it. */
const reviewPick = ref<ReviewAgentPick | null>(null)
const agentList = computed(() => props.agents.filter(a => a.active).map(a => ({ value: a.id, label: a.name })))
const fallbackAgent = () => (props.defaultAgentId && agentList.value.some(a => a.value === props.defaultAgentId) ? props.defaultAgentId : agentList.value[0]?.value ?? '')
watch(() => [props.project.id, agentList.value.length], () => { if (!agentList.value.some(a => a.value === agentId.value)) agentId.value = fallbackAgent() }, { immediate: true })
const { resolvedSelects, state: optionsState, launch, pick, retry } = useAgentLaunchOptions(agentId)
const place = ref<WorkPlace>({ place: 'new', branch_name: '', base_branch: '', branch: '' })
const where = ref<InstanceType<typeof WhereToWork>>()
/** Branches other works of the project already have: one branch cannot be open in two folders. */
const taken = computed(() => Object.fromEntries(work.entries.filter(e => e.workspace && e.workspace.status !== 'removed' && !e.task.closed_at)
  .map(e => [e.workspace!.branch, e.task.title || e.task.external_key || e.task.key])))
// «Ревью» starts as the project's setting; a group has no such setting.
watch(() => props.project.id, async id => {
  place.value = { place: 'new', branch_name: '', base_branch: '', branch: '' }
  review.value = false
  if (isGroup.value) return
  try { const settings = await gitApi.settings(id); if (id === props.project.id) review.value = !!settings.auto_review } catch { /* keep off */ }
}, { immediate: true })

const placeReady = computed(() => isGroup.value || !where.value?.invalid)
const canSubmit = computed(() => !busy.value && !!(number.value.trim() || title.value.trim()) && placeReady.value && (kind.value === 'task' || !!agentId.value))

async function submit() {
  if (!canSubmit.value) {
    if (!placeReady.value) where.value?.openPicker()
    else if (!number.value.trim() && !title.value.trim()) error.value = 'Укажите номер задачи или описание'
    return
  }
  busy.value = true; error.value = ''
  try {
    const p = place.value
    const common = {
      title: title.value.trim(), external_key: number.value.trim(),
      ...(isGroup.value ? {} : p.place === 'new' ? { place: 'new' as const, branch_name: p.branch_name, base_branch: p.base_branch } : { place: 'existing' as const, branch: p.branch, base_branch: p.base_branch }),
    }
    if (kind.value === 'errand') {
      const { task } = await workApi.errand(props.project.id, { ...common, auto_review: review.value,
        ...(review.value && reviewPick.value ? { review_agent: { agent_id: reviewPick.value.agent_id, model: reviewPick.value.model, effort: reviewPick.value.effort } } : {}),
        agent_id: agentId.value, policy: policy.value, ...launch() })
      emit('created', task, 'chat')
    } else {
      const { task } = await workApi.planTask(owner.value || props.project.id, common)
      emit('created', task, 'analysis')
    }
    number.value = ''; title.value = ''
    if (!isGroup.value) place.value = { ...place.value, branch_name: '', branch: '' }
  } catch (cause) { error.value = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '') }
  finally { busy.value = false }
}
</script>
<style scoped>
.nw { padding: var(--sp-3) var(--page-inset, var(--sp-4)); border-bottom: 1px solid var(--border); }
.nw-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.nw-hint { min-width: 0; font-size: var(--fs-sm); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-box { display: flex; flex-direction: column; gap: var(--sp-2); }
.nw-fields { display: flex; gap: var(--sp-2); }
.nw-number { flex: 0 0 150px; }
.nw-title { flex: 1; }
.nw-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
/* Two classes: the settings bar's own top padding (for under a composer) would otherwise win and lower it against the agent select. */
.nw-bar > .nw-settings { padding: 0; }
.nw-send { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); margin-left: auto; }
.nw-review { padding-top: var(--sp-1); }
.nw-note { font-size: var(--fs-sm); color: var(--text-faint); padding: 0 6px; white-space: nowrap; }
.nw-owner { width: 200px; }
@media (max-width: 760px) {
  .nw-hint { display: none; }
  .nw-fields { flex-wrap: wrap; }
  .nw-number { flex: 1 1 100%; }
  .nw-send { width: 100%; justify-content: flex-end; }
}
.nw-error { margin-top: 6px; font-size: var(--fs-sm); color: var(--danger-hover); white-space: pre-wrap; }
</style>
