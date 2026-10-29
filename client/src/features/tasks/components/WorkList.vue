<template>
  <div class="work-list">
    <NewWork :key="project.id" :project="project" :members="members" :agents="agents" :default-agent-id="defaultAgentId" @created="onCreated" />
    <div class="work-toolbar">
      <div class="work-kinds" role="group" aria-label="Фильтр по виду">
        <button v-for="k in kinds" :key="k.id" type="button" :class="{ active: kind === k.id }" @click="kind = k.id">{{ k.label }}<span class="work-kind-count">{{ k.count }}</span></button>
      </div>
      <FormField v-if="isGroup" v-model="owner" type="select" class="work-owner">
        <option value="">Все проекты</option>
        <option value="group">Только группа</option>
        <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
      </FormField>
      <input v-model="search" class="work-search" placeholder="Номер или описание…" aria-label="Поиск" />
    </div>

    <div class="work-groups">
      <p v-if="work.error" role="alert" class="work-error">{{ work.error }}</p>
      <div v-else-if="!work.entries.length && !work.loading" class="empty-state small">Пока ничего нет. Поручите что-нибудь агенту или создайте задачу.</div>
      <div v-else-if="!shown.length" class="empty-state small">Под фильтр ничего не подходит.</div>
      <section v-for="g in groups" :key="g.id" class="work-group">
        <h3 :class="{ clickable: g.id === 'done', attention: g.id === 'attention' }" @click="g.id === 'done' && (doneOpen = !doneOpen)">
          <span v-if="g.id === 'done'" class="caret">{{ doneOpen ? '▾' : '▸' }}</span>{{ g.title }} <span class="work-group-count">· {{ g.items.length }}</span>
        </h3>
        <template v-if="g.id !== 'done' || doneOpen">
          <div
            v-for="e in g.items" :key="e.task.id" class="work-row" :class="[workTone(e.state), { attention: e.state.group === 'attention' }]"
            tabindex="0" role="button" @click="open(e)" @keydown.enter.self="open(e)"
          >
            <span class="work-kind" :class="e.task.kind" :title="e.task.kind === 'errand' ? 'Поручение' : 'Задача с планом'">{{ e.task.kind === 'errand' ? '⚡' : '📋' }}</span>
            <div class="work-main">
              <div class="work-line">
                <code v-if="e.task.external_key" class="work-number">{{ e.task.external_key }}</code>
                <span class="work-title">{{ e.task.title || (e.task.external_key ? '' : '—') }}</span>
                <span v-if="isGroup" class="work-owner-tag" :class="{ own: e.task.project_id === project.id }">{{ e.task.project_id === project.id ? 'группа' : ownerName(e.task.project_id) }}</span>
              </div>
              <div class="work-meta">
                <span class="work-state" :class="{ live: e.state.agentWorking }">{{ e.state.text }}</span>
                <span v-if="branchOf(e)" class="work-branch" :title="'Ветка: ' + branchOf(e)">⎇ {{ branchOf(e) }}</span>
                <span v-if="inMainFolder(e)" class="work-main-folder" title="Работа идёт в основной папке проекта">основная папка</span>
                <span v-if="e.task.kind !== 'errand' && e.state.counts.steps">шаги {{ e.state.counts.completed }}/{{ e.state.counts.steps }}</span>
                <span v-if="e.state.counts.remarks && e.state.group !== 'done'" class="work-remarks">💬 замечаний: {{ e.state.counts.remarks }}</span>
              </div>
            </div>
            <div class="work-stage" :title="stageTitle(e)">
              <span class="work-bars"><i v-for="(b, i) in bars(e)" :key="i" :class="b" /></span>
              <span class="work-stage-name">{{ stageName(e) }}</span>
            </div>
            <div class="work-actions">
              <template v-if="e.state.group !== 'done'">
                <AppButton :variant="e.state.group === 'attention' ? 'primary' : 'subtle'" size="sm" @click.stop="open(e)">{{ e.state.actionLabel }}</AppButton>
              </template>
              <template v-else>
                <AppButton v-if="e.state.action === 'errand'" variant="subtle" size="sm" @click.stop="startFollowUp(e.task)">Поручение по этой</AppButton>
                <AppButton v-else variant="subtle" size="sm" @click.stop="reopen(e.task)">Открыть снова</AppButton>
              </template>
              <span class="work-menu" @click.stop><AppMenu :items="rowMenu(e.task)" size="sm" title="Действия с работой" /></span>
            </div>
          </div>
        </template>
      </section>
    </div>

    <AppModal :model-value="!!editing" :title="editing?.kind === 'errand' ? 'Редактировать поручение' : 'Редактировать задачу'" :confirm-label="saving ? 'Сохранение…' : 'Сохранить'" @update:model-value="closeEditor" @confirm="saveEdit">
      <form ref="editForm" class="work-edit" @submit.prevent="saveEdit" @keydown.esc.stop="closeEditor">
        <FormField v-model="numberDraft" label="Номер задачи" placeholder="PROJ-123" maxlength="100" :disabled="saving" />
        <FormField v-model="titleDraft" label="Описание" placeholder="Что нужно сделать" maxlength="300" :disabled="saving" />
        <p v-if="editError" class="work-error" role="alert">{{ editError }}</p>
        <button type="submit" hidden />
      </form>
    </AppModal>
    <AppModal :model-value="!!followUp" title="Поручение по этой работе" confirm-label="Поручить" @update:model-value="followUp = null" @confirm="submitFollowUp">
      <FormField v-model="followText" label="Что нужно сделать" placeholder="Что поправить после влития МР?" />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Agent, Project, Task, WorkEntry } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { api } from '@core/api'
import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import FormField from '@shared/ui/FormField.vue'
import NewWork from './NewWork.vue'
import { useWorkStore } from '../stores/work'
import { useWorkActions } from '../composables/useWorkActions'
import { workGroups, workStageIndex, workStagesOf, workTab, workTone } from '../utils/work-state'

const props = defineProps<{ project: Project; members: Project[]; agents: Agent[]; defaultAgentId?: string | null; ownerName: (projectId: string) => string; moveMenu?: (task: Task) => MenuItem[] }>()
const emit = defineEmits<{ open: [Task, string]; changed: [] }>()
const router = useRouter(), app = useAppStore(), work = useWorkStore(), actions = useWorkActions()
const isGroup = computed(() => props.project.kind === 'group')
const kind = ref<'all' | 'task' | 'errand'>('all'), owner = ref(''), search = ref(''), doneOpen = ref(false)

const ids = computed(() => [props.project.id, ...(isGroup.value ? props.members.map(m => m.id) : [])])
watch(ids, value => void work.load(value), { immediate: true })

const matching = computed(() => {
  const q = search.value.trim().toLowerCase()
  return work.entries.filter(e =>
    (!owner.value || (owner.value === 'group' ? e.task.project_id === props.project.id : e.task.project_id === owner.value)) &&
    (!q || (e.task.title ?? '').toLowerCase().includes(q) || (e.task.external_key ?? '').toLowerCase().includes(q)))
})
const kinds = computed(() => [
  { id: 'all' as const, label: 'Все', count: matching.value.length },
  { id: 'task' as const, label: 'Задачи', count: matching.value.filter(e => e.task.kind === 'task').length },
  { id: 'errand' as const, label: '⚡ Поручения', count: matching.value.filter(e => e.task.kind === 'errand').length },
])
const shown = computed(() => matching.value.filter(e => kind.value === 'all' || e.task.kind === kind.value))
const groups = computed(() => workGroups
  .map(g => ({ ...g, items: shown.value.filter(e => e.state.group === g.id) }))
  .filter(g => g.items.length))

const branchOf = (e: WorkEntry) => e.workspace?.branch ?? e.task.branch_name ?? ''
const inMainFolder = (e: WorkEntry) => !isGroup.value && !e.workspace && !!e.task.base_commit && e.state.group !== 'done'
const stageName = (e: WorkEntry) => e.state.group === 'done' ? 'Готово' : workStagesOf(e.task)[Math.min(workStageIndex(e.task, e.state), workStagesOf(e.task).length - 1)]?.label ?? ''
const stageTitle = (e: WorkEntry) => workStagesOf(e.task).map(s => s.label).join(' → ')
/** One bar per stage: passed — green, the current one — by what it waits for, the rest — grey. */
function bars(e: WorkEntry) {
  const current = workStageIndex(e.task, e.state), tone = e.state.group === 'attention' ? 'attention' : 'current'
  return workStagesOf(e.task).map((_, i) => i < current ? 'passed' : i === current ? tone : '')
}
function open(e: WorkEntry) { emit('open', e.task, workTab(e.state, e.task.kind)) }
function onCreated(task: Task, tab: string) {
  void work.load(); emit('changed')
  emit('open', task, tab)
}

async function reopen(task: Task) { if (await actions.reopen(task)) { await work.load(); emit('changed') } }
async function remove(task: Task) { if (await actions.remove(task)) { await work.load(); emit('changed') } }
function rowMenu(task: Task): MenuItem[] {
  const moves = props.moveMenu?.(task) ?? []
  return [
    { label: 'Редактировать', hint: 'Номер задачи и описание', action: () => void edit(task) },
    ...(moves.some(item => item.action) ? [{ separator: true }, ...moves] : []),
    { separator: true },
    { label: 'Удалить', hint: 'Без возможности восстановления', danger: true, action: () => void remove(task) },
  ]
}
const editing = ref<Task | null>(null), saving = ref(false), editError = ref('')
const numberDraft = ref(''), titleDraft = ref(''), editForm = ref<HTMLFormElement>()
async function edit(task: Task) {
  editing.value = task; numberDraft.value = task.external_key ?? ''; titleDraft.value = task.title ?? ''; editError.value = ''
  await nextTick()
  const input = editForm.value?.querySelector<HTMLInputElement>('input')
  input?.focus(); input?.select()
}
function closeEditor() { if (!saving.value) editing.value = null }
async function saveEdit() {
  const task = editing.value
  if (!task || saving.value) return
  const title = titleDraft.value.trim(), number = numberDraft.value.trim()
  if (!title && !number) { editError.value = 'Укажите номер задачи или описание'; return }
  saving.value = true; editError.value = ''
  try {
    const updated = await api.patch<Task>(`/projects/${task.project_id}/tasks/${task.id}`, { title, external_key: number || null })
    if (app.currentTask?.id === updated.id) app.currentTask = updated
    editing.value = null
    await work.load(); emit('changed')
    app.toast('Сохранено', 'success')
  } catch (cause) { editError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { saving.value = false }
}
const followUp = ref<Task | null>(null), followText = ref('')
function startFollowUp(task: Task) { followUp.value = task; followText.value = '' }
async function submitFollowUp() {
  const task = followUp.value
  if (!task) return
  const result = await actions.errandFrom(task, followText.value, props.defaultAgentId)
  if (!result) return
  followUp.value = null
  await work.load(); emit('changed')
  app.toast('Поручение запущено', 'success')
  router.push('/task/' + result.task.id)
}
</script>

<style scoped>
.work-list { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.work-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 16px 0; }
.work-kinds { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.work-kinds button { padding: 5px 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12.5px; }
.work-kinds button.active { background: var(--bg3); color: var(--text); }
.work-kind-count { margin-left: 5px; font-size: 11px; color: var(--text-faint); }
.work-owner { width: 190px; }
.work-search { margin-left: auto; width: 220px; height: var(--size-sm); padding: 0 10px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 12.5px; }
.work-search:focus { outline: none; border-color: var(--blue); }
.work-groups { flex: 1; overflow: auto; padding: 0 16px 16px; }
.work-error { color: var(--danger-hover); }
.work-group h3 { margin: 14px 0 6px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
.work-group h3.attention { color: var(--warning-text); }
.work-group h3.clickable { cursor: pointer; }
.work-group-count { color: var(--text-faint); }
.caret { margin-right: 6px; }
.work-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 8px 12px; margin-bottom: 4px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.work-row.attention { box-shadow: inset 2px 0 0 var(--warning); }
.work-row.danger { box-shadow: inset 2px 0 0 var(--danger-hover); }
.work-row:hover, .work-row:focus-visible { border-color: var(--border-strong); background: var(--bg3); outline: none; }
.work-kind { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; font-size: 12px; }
.work-kind.errand { background: var(--warning-soft); }
.work-kind.task { background: var(--blue-soft); }
.work-main { min-width: 0; }
.work-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.work-number { flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
.work-title { min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-meta { display: flex; align-items: center; gap: 10px; margin-top: 2px; min-width: 0; font-size: 11.5px; color: var(--text-faint); white-space: nowrap; overflow: hidden; }
.work-state { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
.work-row.attention .work-state { color: var(--warning-text); }
.work-row.danger .work-state { color: var(--danger-hover); }
.work-state.live { color: var(--blue-hover); }
.work-state.live::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: currentColor; vertical-align: 1px; animation: work-pulse 1.4s ease-in-out infinite; }
@keyframes work-pulse { 50% { opacity: 0.3; } }
.work-branch { max-width: 280px; overflow: hidden; text-overflow: ellipsis; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; color: var(--text-muted); }
.work-main-folder { color: var(--warning-text); }
.work-stage { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 120px; }
.work-bars { display: flex; gap: 3px; }
.work-bars i { width: 16px; height: 4px; border-radius: 2px; background: var(--border-strong); }
.work-bars i.passed { background: var(--accent-hover); }
.work-bars i.current { background: var(--blue-hover); }
.work-bars i.attention { background: var(--warning); }
.work-stage-name { font-size: 11.5px; color: var(--text-muted); }
.work-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 130px; }
.work-owner-tag { flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: 11px; color: var(--text-muted); }
.work-owner-tag.own { color: var(--blue-hover); border-color: var(--blue-soft); }
.work-menu { display: inline-flex; }
.work-edit { display: flex; flex-direction: column; gap: 12px; }
</style>
