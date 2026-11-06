<template>
  <form class="nw" @submit.prevent="submit">
    <div class="nw-head">
      <AppSegmented :model-value="kind" :options="[{ value: 'errand', label: '⚡ Поручение' }, { value: 'task', label: '📋 Задача с планом' }]" label="Что создать" @update:model-value="kind = $event as 'errand' | 'task'" />
      <span class="nw-hint">{{ kind === 'errand' ? 'Сразу к делу, без анализа и плана. Подробности напишете агенту в чате.' : 'Анализ, план и очередь шагов.' }}</span>
    </div>
    <div class="nw-box" :class="{ focused }" @focusin="focused = true" @focusout="focused = false">
      <div class="nw-fields">
        <AppInput v-model="number" class="nw-number" mono placeholder="Номер задачи" aria-label="Номер задачи" maxlength="100" :disabled="busy" />
        <AppInput
          v-model="title" class="nw-title" aria-label="Описание" maxlength="300" :disabled="busy"
          :placeholder="kind === 'errand' ? 'Что нужно сделать? Например: поправить вёрстку в профиле' : 'Описание задачи'"
        />
      </div>
      <div class="nw-bar">
        <template v-if="kind === 'errand'">
          <AppSelect v-model="agentId" :options="agentList" size="sm" variant="subtle" heading="Агент, который выполнит поручение" placeholder="Агент" />
          <AgentSettingsBar class="nw-settings" :policy="policy" :selects="resolvedSelects" @policy="policy = $event" @change="pick">
            <span v-if="optionsState === 'loading'" class="nw-note">Загружаю модели агента…</span>
            <span v-else-if="optionsState" class="nw-note" :title="optionsState">Нет настроек агента · <AppButton variant="link" size="xs" @click="retry">повторить</AppButton></span>
          </AgentSettingsBar>
          <span class="nw-spacer" />
          <WhereToWork ref="where" v-model="place" :project-id="project.id" :ordinary="!isGroup" :taken="taken" />
          <AppSwitch v-model="review" :title="review ? 'После выполнения агент-ревьюер проверит изменения' : 'Без автоматического ревью агентом'">Ревью</AppSwitch>
          <AppButton type="submit" variant="blue" size="sm" :disabled="!canSubmit">{{ busy ? 'Создаю…' : '⚡ Поручить' }}</AppButton>
        </template>
        <template v-else>
          <FormField v-if="isGroup && members.length" v-model="owner" type="select" class="nw-owner" aria-label="Где">
            <option value="">🗂️ Вся группа</option>
            <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
          </FormField>
          <span class="nw-spacer" />
          <AppButton type="submit" variant="primary" size="sm" :disabled="!canSubmit">{{ busy ? 'Создаю…' : 'Создать и начать анализ →' }}</AppButton>
        </template>
      </div>
    </div>
    <p v-if="error" class="nw-error" role="alert">{{ error }}</p>
  </form>
</template>
<script setup lang="ts">
import AppInput from '@shared/ui/AppInput.vue'
import { AppSegmented, AppSwitch } from '@shared/ui'
import { tasksEndpoints } from '../api'

import { useDraft } from '@core/composables/useDraft'
import { computed, ref, watch } from 'vue'
import type { Agent, Project, Task } from '@contracts'
import { AgentSettingsBar, useAgentLaunchOptions } from '@features/agent-chat'
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
const number = useDraft(() => `project:${props.project.id}:new-work:number`, () => ''), title = useDraft(() => `project:${props.project.id}:new-work:title`, () => ''), owner = useDraft(() => `project:${props.project.id}:new-work:owner`, () => ''), busy = ref(false), error = ref(''), focused = ref(false)

// Errand: who does it and how — chosen every time, starting from the project's agent and its own settings.
const agentId = ref(''), policy = ref('allow-all'), review = ref(false)
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
const canSubmit = computed(() => !busy.value && !!(number.value.trim() || title.value.trim()) && (kind.value === 'task' || (!!agentId.value && placeReady.value)))

async function submit() {
  if (!canSubmit.value) {
    if (kind.value === 'errand' && !placeReady.value) where.value?.openPicker()
    else if (!number.value.trim() && !title.value.trim()) error.value = 'Укажите номер задачи или описание'
    return
  }
  busy.value = true; error.value = ''
  try {
    if (kind.value === 'errand') {
      const p = place.value
      const { task } = await workApi.errand(props.project.id, {
        title: title.value.trim(), external_key: number.value.trim(), agent_id: agentId.value, policy: policy.value, ...launch(), auto_review: review.value,
        ...(isGroup.value ? {} : p.place === 'new' ? { place: 'new', branch_name: p.branch_name, base_branch: p.base_branch } : { place: 'existing', branch: p.branch, base_branch: p.base_branch }),
      })
      emit('created', task, 'chat')
    } else {
      const task = await tasksEndpoints.postProjectsByProjectIdTasks({ params: { projectId: owner.value || props.project.id }, body: { title: title.value.trim() || undefined, external_key: number.value.trim() || undefined } })
      emit('created', task, 'analysis')
    }
    number.value = ''; title.value = ''
    if (!isGroup.value) place.value = { ...place.value, branch_name: '', branch: '' }
  } catch (cause) { error.value = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '') }
  finally { busy.value = false }
}
</script>
<style scoped>
.nw { padding: var(--sp-3) var(--sp-4) var(--sp-3); border-bottom: 1px solid var(--border); }
.nw-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.nw-kinds { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.nw-kinds button { padding: 5px 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: var(--fs-md); }
.nw-kinds button.on { background: var(--bg3); color: var(--text); }
.nw-hint { min-width: 0; font-size: var(--fs-sm); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-box { background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); transition: border-color var(--motion-fast), box-shadow var(--motion-fast); }
.nw-box.focused { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.nw-fields { display: flex; align-items: stretch; padding-top: 6px; }
.nw-number { flex: 0 0 150px; }
.nw-title { flex: 1; }
.nw-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; padding: 4px 8px 8px; }
.nw-settings { padding-top: 0; }
.nw-spacer { flex: 1; }
.nw-note { font-size: var(--fs-sm); color: var(--text-faint); padding: 0 6px; white-space: nowrap; }
.nw-owner { width: 200px; }
.nw-error { margin-top: 6px; font-size: var(--fs-sm); color: var(--danger-hover); white-space: pre-wrap; }
</style>
