<template>
  <div class="work-list">
    <ErrandLine :key="project.id" :project-id="project.id" :default-agent-id="defaultAgentId" :agents="agents" :ordinary="!isGroup" @created="onCreated" />
    <div class="work-toolbar">
      <AppButton variant="primary" size="sm" @click="openCreate">+ Задача с планом</AppButton>
      <div class="work-kinds" role="group" aria-label="Фильтр по виду">
        <button v-for="k in kinds" :key="k.id" type="button" :class="{ active: kind === k.id }" @click="kind = k.id">{{ k.label }}</button>
      </div>
      <FormField v-if="isGroup" v-model="owner" type="select" class="work-owner">
        <option value="">Все проекты</option>
        <option value="group">Только группа</option>
        <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
      </FormField>
      <input v-model="search" class="work-search" placeholder="Ключ или название…" aria-label="Поиск" />
    </div>

    <div class="work-groups">
      <p v-if="work.error" role="alert" class="work-error">{{ work.error }}</p>
      <div v-else-if="!work.entries.length && !work.loading" class="empty-state small">Пока ничего нет. Поручите что-нибудь агенту или создайте задачу.</div>
      <div v-else-if="!shown.length" class="empty-state small">Под фильтр ничего не подходит.</div>
      <section v-for="g in groups" :key="g.id" class="work-group">
        <h3 :class="{ clickable: g.id === 'done' }" @click="g.id === 'done' && (doneOpen = !doneOpen)">
          <span v-if="g.id === 'done'" class="caret">{{ doneOpen ? '▾' : '▸' }}</span>{{ g.title }} · {{ g.items.length }}
        </h3>
        <template v-if="g.id !== 'done' || doneOpen">
          <div v-for="e in g.items" :key="e.task.id" class="work-row" :class="workTone(e.state)" tabindex="0" role="button" @click="open(e)" @keydown.enter.self="open(e)">
            <span class="work-icon" :title="e.state.status">{{ e.state.icon }}</span>
            <code class="work-key">{{ e.task.kind === 'errand' ? '⚡' : e.task.key }}</code>
            <span class="work-title">{{ e.task.title || '—' }}</span>
            <span v-if="isGroup" class="work-owner-tag" :class="{ own: e.task.project_id === project.id }">{{ e.task.project_id === project.id ? 'группа' : ownerName(e.task.project_id) }}</span>
            <span class="work-text">{{ stageLine(e) }}</span>
            <template v-if="e.state.group !== 'done'">
              <AppButton :variant="e.state.group === 'attention' ? 'primary' : 'subtle'" size="sm" @click.stop="open(e)">{{ e.state.actionLabel }}</AppButton>
            </template>
            <template v-else>
              <AppButton v-if="e.state.action === 'errand'" variant="subtle" size="sm" @click.stop="startFollowUp(e.task)">Поручение по этой</AppButton>
              <AppButton v-else variant="subtle" size="sm" @click.stop="reopen(e.task)">Открыть снова</AppButton>
              <button type="button" class="work-del" title="Удалить" @click.stop="remove(e.task)"><IconTrash /></button>
            </template>
            <span v-if="moveMenu && moveMenu(e.task).length > 1" class="work-menu" @click.stop><AppMenu :items="moveMenu(e.task)" size="xs" title="Переместить" /></span>
          </div>
        </template>
      </section>
    </div>

    <AppModal v-model="showCreate" title="Новая задача с планом" confirm-label="Создать" @confirm="create">
      <FormField v-model="form.title" label="Название" placeholder="Добавить авторизацию" />
      <FormField v-model="form.key" label="Внешний ключ (по желанию)" placeholder="PROJ-123" hint="Номер «Задача-N» Plangent присвоит сам." />
      <FormField v-if="isGroup && members.length" v-model="form.owner" label="Где" type="select" hint="Задача группы: агент работает сразу со всеми проектами группы.">
        <option value="">🗂 Вся группа</option>
        <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
      </FormField>
    </AppModal>
    <AppModal :model-value="!!followUp" title="Поручение по этой работе" confirm-label="Поручить" @update:model-value="followUp = null" @confirm="submitFollowUp">
      <FormField v-model="followText" label="Что нужно сделать" placeholder="Что поправить после влития МР?" />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Agent, Project, Task, WorkEntry } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { api } from '@core/api'
import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import FormField from '@shared/ui/FormField.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import ErrandLine from './ErrandLine.vue'
import { useWorkStore } from '../stores/work'
import { useWorkActions } from '../composables/useWorkActions'
import { workGroups, workTab, workTone } from '../utils/work-state'

const props = defineProps<{ project: Project; members: Project[]; agents: Agent[]; defaultAgentId?: string | null; ownerName: (projectId: string) => string; moveMenu?: (task: Task) => MenuItem[] }>()
const emit = defineEmits<{ open: [Task, string]; changed: [] }>()
const router = useRouter(), app = useAppStore(), work = useWorkStore(), actions = useWorkActions()
const isGroup = computed(() => props.project.kind === 'group')
const kinds = [{ id: 'all', label: 'Все' }, { id: 'task', label: 'Задачи' }, { id: 'errand', label: 'Поручения' }] as const
const kind = ref<'all' | 'task' | 'errand'>('all'), owner = ref(''), search = ref(''), doneOpen = ref(false)

const ids = computed(() => [props.project.id, ...(isGroup.value ? props.members.map(m => m.id) : [])])
watch(ids, value => void work.load(value), { immediate: true })

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return work.entries.filter(e =>
    (kind.value === 'all' || e.task.kind === kind.value) &&
    (!owner.value || (owner.value === 'group' ? e.task.project_id === props.project.id : e.task.project_id === owner.value)) &&
    (!q || e.task.key.toLowerCase().includes(q) || (e.task.title ?? '').toLowerCase().includes(q) || (e.task.external_key ?? '').toLowerCase().includes(q)))
})
const groups = computed(() => workGroups
  .map(g => ({ ...g, items: shown.value.filter(e => e.state.group === g.id) }))
  .filter(g => g.items.length))

function stageLine(e: WorkEntry) {
  const c = e.state.counts
  const progress = e.task.kind !== 'errand' && e.state.stage === 'execution' && c.steps ? ` · шаги ${c.completed}/${c.steps}` : ''
  const remarks = c.remarks && e.state.group !== 'done' ? ` · 🤖 замечаний: ${c.remarks}` : ''
  return e.state.text + progress + remarks
}
function open(e: WorkEntry) { emit('open', e.task, workTab(e.state, e.task.kind)) }
function onCreated(task: Task) { void work.load(); emit('changed'); app.toast('Поручение запущено: ' + (task.title || task.key), 'success') }

const showCreate = ref(false), form = ref({ title: '', key: '', owner: '' })
function openCreate() { form.value = { title: '', key: '', owner: '' }; showCreate.value = true }
async function create() {
  const ownerId = form.value.owner || props.project.id
  try {
    const task = await api.post<Task>(`/projects/${ownerId}/tasks`, { title: form.value.title, external_key: form.value.key.trim() || undefined })
    showCreate.value = false
    await work.load(); emit('changed')
    emit('open', task, 'plan')
  } catch (cause) { app.toast(String(cause), 'error') }
}

async function reopen(task: Task) { if (await actions.reopen(task)) { await work.load(); emit('changed') } }
async function remove(task: Task) { if (await actions.remove(task)) { await work.load(); emit('changed') } }
const followUp = ref<Task | null>(null), followText = ref('')
function startFollowUp(task: Task) { followUp.value = task; followText.value = '' }
async function submitFollowUp() {
  const task = followUp.value
  if (!task) return
  const result = await actions.errandFrom(task, followText.value, props.defaultAgentId)
  if (!result) return
  followUp.value = null
  await work.load(); emit('changed')
  router.push('/task/' + result.task.id)
}
</script>

<style scoped>
.work-list { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.work-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 16px; }
.work-kinds { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.work-kinds button { padding: 5px 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12.5px; }
.work-kinds button.active { background: var(--bg3); color: var(--text); }
.work-owner { width: 190px; }
.work-search { margin-left: auto; width: 220px; height: var(--size-md); padding: 0 10px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 13px; }
.work-search:focus { outline: none; border-color: var(--blue); }
.work-groups { flex: 1; overflow: auto; padding: 0 16px 16px; }
.work-error { color: var(--danger-hover); }
.work-group h3 { margin: 14px 0 6px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
.work-group h3.clickable { cursor: pointer; }
.caret { margin-right: 6px; }
.work-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 4px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.work-row:hover, .work-row:focus-visible { border-color: var(--border-strong); background: var(--bg3); outline: none; }
.work-icon { width: 20px; text-align: center; flex-shrink: 0; }
.work-row.warn .work-icon { color: var(--warning); }
.work-row.danger .work-icon { color: var(--danger-hover); }
.work-row.progress .work-icon { color: var(--blue-hover); }
.work-row.done .work-icon { color: var(--accent-hover); }
.work-key { flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
.work-title { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-text { flex-shrink: 0; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-muted); }
.work-owner-tag { flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: 11px; color: var(--text-muted); }
.work-owner-tag.own { color: var(--blue-hover); border-color: var(--blue-soft); }
.work-del { background: none; border: none; padding: 4px; color: var(--danger-hover); cursor: pointer; opacity: 0.6; }
.work-del:hover { opacity: 1; }
.work-del :deep(svg) { width: 16px; height: 16px; }
.work-menu { opacity: 0; transition: opacity 0.12s; }
.work-row:hover .work-menu, .work-menu:has(.menu.open) { opacity: 1; }
</style>
