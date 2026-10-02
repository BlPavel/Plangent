<template>
  <div class="home">
    <div v-if="!currentProject" class="empty-state">
      <p>Выберите проект или создайте новый</p>
    </div>

    <!-- The store copy: sync status and statistics arrive there over server events. -->
    <SourceView v-else-if="currentProject.kind === 'source'" :source="projectsStore.byId(currentProject.id) ?? currentProject" @edit="showProjectModal = true" @delete="deleteProject" />

    <div v-else class="project-area">
      <!-- Project / group header -->
      <div class="project-header app-drag">
        <div class="project-title">
          <h1><span class="title-icon">{{ isGroup ? '🗂' : '📁' }}</span>{{ currentProject.name }}</h1>
          <span v-if="isGroup" class="repo-path">
            {{ members.length ? `Проекты: ${members.map(m => m.name).join(', ')}` : 'В группе пока нет проектов — добавьте их на вкладке «Проекты»' }}
          </span>
          <span v-else class="repo-path">
            <button v-if="group" class="crumb app-no-drag" title="Открыть группу" @click="appStore.currentProject = group">🗂 {{ group.name }} ›</button>
            <code class="project-key">@{{ currentProject.key }}</code> {{ currentProject.repo_path }}
          </span>
        </div>
        <div class="project-header-actions">
          <AppButton variant="ghost" size="sm" @click="showProjectModal = true">{{ isGroup ? 'Настройки группы' : 'Настройки проекта' }}</AppButton>
          <AppButton variant="danger-ghost" size="sm" @click="deleteProject">Удалить</AppButton>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab-btn"
          :class="{ active: activeTab === t.id, disabled: t.disabled }"
          :disabled="t.disabled"
          @click="activeTab = t.id"
        >{{ t.label }}</button>
      </div>

      <div v-show="activeTab === 'agents'" class="tab-content"><AgentChats :project-id="currentProject.id" :default-agent-id="projectsStore.agentFor(currentProject)" /></div>
      <div v-if="isGroup" v-show="activeTab === 'projects'" class="tab-content"><GroupProjects :group="currentProject" /></div>
      <div v-show="activeTab === 'terminal'" class="tab-content"><TerminalsView :project-id="currentProject.id" :visible="activeTab === 'terminal'" /></div>
      <div v-show="activeTab === 'tasks'" class="tab-content tasks-tab">
        <div class="task-actions">
          <AppButton variant="primary" @click="openCreateTask">+ Задача</AppButton>
          <template v-if="isGroup">
            <FormField v-model="taskFilter.project" type="select" class="task-filter">
              <option value="">Все проекты</option>
              <option value="group">Только задачи группы</option>
              <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
            </FormField>
            <FormField v-model="taskFilter.status" type="select" class="task-filter">
              <option value="">Любой статус</option>
              <option value="active">Активные</option>
              <option value="done">Выполненные</option>
            </FormField>
            <input v-model="taskFilter.text" class="task-search" placeholder="Ключ или название…" />
          </template>
        </div>
        <div class="task-list">
          <div v-if="!tasks.length" class="empty-state small">
            Нет задач. Создайте первую.
          </div>
          <div v-else-if="!shownTasks.length" class="empty-state small">
            Под фильтр ничего не подходит.
          </div>
          <div
            v-for="t in shownTasks"
            :key="t.id"
            class="task-card"
            @click="openTask(t)"
          >
            <code class="task-key">{{ t.key }}</code>
            <span class="task-title">{{ t.title || '—' }}</span>
            <span v-if="isGroup" class="task-owner" :class="{ own: t.project_id === currentProject.id }">
              {{ t.project_id === currentProject.id ? 'группа' : ownerName(t) }}
            </span>
            <StatusBadge :status="t.status" />
            <button v-if="t.status !== 'done'" class="task-act task-done" title="Завершить задачу" @click.stop="markDoneTaskCard(t)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
            </button>
            <button v-else class="task-act task-reopen" title="Вернуть в работу" @click.stop="reopenTaskCard(t)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v3h3" /></svg>
            </button>
            <span v-if="moveTargets(t).length" class="task-menu" @click.stop>
              <AppMenu :items="moveMenu(t)" size="xs" title="Переместить" />
            </span>
            <button class="task-act task-del" title="Удалить задачу" @click.stop="deleteTaskCard(t)">
              <IconTrash />
            </button>
          </div>
        </div>
      </div>

      <!-- Tab: Инструкции -->
      <div v-show="activeTab === 'instructions'" class="tab-content instructions-tab">
        <InstructionsWorkspace v-if="currentProject" :project-id="currentProject.id" :default-agent-id="projectsStore.agentFor(currentProject)" />
      </div>

      <!-- Tab: Интеграции (disabled placeholder) -->
      <div v-show="activeTab === 'integrations'" class="tab-content placeholder-tab">
        <div class="placeholder">
          <div class="placeholder-icon">🔗</div>
          <div class="placeholder-title">Интеграции</div>
          <div class="placeholder-text">Jira, GitHub Issues, Linear — скоро</div>
        </div>
      </div>

      <!-- Tab: Доки (disabled placeholder) -->
      <div v-show="activeTab === 'docs'" class="tab-content placeholder-tab">
        <div class="placeholder">
          <div class="placeholder-icon">📄</div>
          <div class="placeholder-title">Документация</div>
          <div class="placeholder-text">Скоро</div>
        </div>
      </div>
    </div>

    <!-- Create task modal -->
    <AppModal v-model="showTaskModal" title="Новая задача" confirm-label="Создать" @confirm="createTask">
      <FormField v-model="taskForm.key" label="Ключ задачи" placeholder="PROJ-123" />
      <FormField v-model="taskForm.title" label="Название" placeholder="Добавить авторизацию" />
      <FormField
        v-if="isGroup && members.length" v-model="taskForm.owner" label="Где" type="select"
        hint="Задача группы: агент работает сразу со всеми проектами группы."
      >
        <option value="">🗂 Вся группа</option>
        <option v-for="m in members" :key="m.id" :value="m.id">📁 {{ m.name }}</option>
      </FormField>
    </AppModal>

    <ProjectFormModal
      v-if="currentProject"
      v-model="showProjectModal"
      :kind="currentProject.kind"
      :project="currentProject"
      @saved="p => appStore.currentProject = p"
      @manage-projects="activeTab = 'projects'"
    />
  </div>
</template>

<script lang="ts">
type HomeTab = 'agents' | 'projects' | 'terminal' | 'tasks' | 'instructions' | 'integrations' | 'docs'
// Module-level so it survives HomeView being unmounted while a task is open.
const lastTab: { projectId: string | null; tab: HomeTab } = { projectId: null, tab: 'agents' }
</script>

<script setup lang="ts">
import { TerminalsView } from '@features/terminal'
import { AgentChats } from '@features/agent-chat'
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '../stores/projects'
import { useAgentsStore } from '@features/agents'
import { api } from '@core/api'
import type { Task } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import FormField from '@shared/ui/FormField.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { InstructionsWorkspace } from '@features/library'
import ProjectFormModal from '../components/ProjectFormModal.vue'
import GroupProjects from '../components/GroupProjects.vue'
import SourceView from '../components/SourceView.vue'

const router = useRouter()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

const currentProject = computed(() => appStore.currentProject)
const isGroup = computed(() => currentProject.value?.kind === 'group')
const group = computed(() => projectsStore.byId(currentProject.value?.group_id))
const members = computed(() => isGroup.value ? projectsStore.members(currentProject.value!.id) : [])
const tasks = ref<Task[]>([])

// A freshly opened project starts on «Агенты»; coming back from a task restores the tab you left.
const activeTab = ref<HomeTab>(lastTab.projectId && lastTab.projectId === appStore.currentProject?.id ? lastTab.tab : 'agents')
watch(activeTab, tab => { if (currentProject.value) Object.assign(lastTab, { projectId: currentProject.value.id, tab }) }, { immediate: true })
const tabs = computed(() => [
  ...(isGroup.value ? [{ id: 'projects' as const, label: `Проекты · ${members.value.length}`, disabled: false }] : []),
  { id: 'agents' as const, label: 'Агенты', disabled: false },
  { id: 'terminal' as const, label: 'Терминал', disabled: false },
  { id: 'tasks' as const, label: 'Задачи', disabled: false },
  { id: 'instructions' as const, label: 'Инструкции', disabled: false },
  { id: 'integrations' as const, label: 'Интеграции', disabled: true },
  { id: 'docs' as const, label: 'Доки', disabled: true },
])

const showTaskModal = ref(false)
const showProjectModal = ref(false)
const taskForm = ref({ key: '', title: '', owner: '' })

// Group page: its own tasks and its projects' tasks, filtered.
const taskFilter = ref({ project: '', status: 'active', text: '' })
const shownTasks = computed(() => {
  if (!isGroup.value) return tasks.value
  const { project, status, text } = taskFilter.value
  const q = text.trim().toLowerCase()
  return tasks.value.filter(t =>
    (!project || (project === 'group' ? t.project_id === currentProject.value!.id : t.project_id === project)) &&
    (!status || (status === 'done') === (t.status === 'done')) &&
    (!q || t.key.toLowerCase().includes(q) || (t.title ?? '').toLowerCase().includes(q)))
})
const ownerName = (t: Task) => projectsStore.byId(t.project_id)?.name ?? '—'

onMounted(() => agentsStore.load())

watch(() => currentProject.value?.id, () => { loadTasks() }, { immediate: true })
watch(() => currentProject.value?.id, id => {
  activeTab.value = 'agents'
  taskFilter.value = { project: '', status: 'active', text: '' }
  Object.assign(lastTab, { projectId: id ?? null, tab: 'agents' })
})

async function loadTasks() {
  const p = currentProject.value
  if (!p || p.kind === 'source') { tasks.value = []; return }
  tasks.value = await api.get<Task[]>(`/projects/${p.id}/tasks${p.kind === 'group' ? '?members=1' : ''}`)
}

function openCreateTask() {
  taskForm.value = { key: '', title: '', owner: '' }
  showTaskModal.value = true
}

async function createTask() {
  if (!currentProject.value || !taskForm.value.key) return
  const ownerId = taskForm.value.owner || currentProject.value.id
  if (tasks.value.some(t => t.key === taskForm.value.key && t.project_id === ownerId)) {
    appStore.toast(`Ключ «${taskForm.value.key}» уже занят`, 'error')
    return
  }
  try {
    const t = await api.post<Task>(`/projects/${ownerId}/tasks`, { key: taskForm.value.key, title: taskForm.value.title })
    tasks.value.unshift(t)
    appStore.toast('Задача создана', 'success')
    showTaskModal.value = false
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function deleteProject() {
  const p = currentProject.value
  if (!p) return
  const message = p.kind === 'group'
    ? `Удалить группу «${p.name}»? Проекты останутся и выйдут из группы, а задачи и чаты самой группы будут удалены безвозвратно.`
    : p.kind === 'source'
      ? p.source_type === 'docs'
        ? `Удалить справочник @${p.key}? Скачанные документы будут удалены с диска; во внешнем сервисе ничего не изменится.`
        : `Удалить справочник @${p.key}? Папка на диске не изменится.`
      : `Удалить проект «${p.name}»? Все его задачи, чаты и настройки будут удалены безвозвратно.`
  const ok = await appStore.confirm(message, { confirmLabel: 'Удалить', danger: true })
  if (!ok) return
  try {
    await projectsStore.remove(p.id)
    appStore.currentProject = projectsStore.workProjects[0] ?? projectsStore.projects[0] ?? null
    appStore.toast('Удалено', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

// The task page works in the task's own project, also when opened from its group.
function openTask(t: Task) {
  const owner = projectsStore.byId(t.project_id)
  if (owner && owner.id !== currentProject.value?.id) appStore.currentProject = owner
  appStore.currentTask = t
  router.push(`/task/${t.id}`)
}

/** Where a task can move: a group's task into one of its projects, a project's task up into its group. */
function moveTargets(t: Task) {
  const owner = projectsStore.byId(t.project_id)
  if (!owner) return []
  if (owner.kind === 'group') return projectsStore.members(owner.id)
  const g = projectsStore.byId(owner.group_id)
  return g ? [g] : []
}
function moveMenu(t: Task): MenuItem[] {
  return [{ heading: 'Переместить задачу' }, ...moveTargets(t).map(target => ({
    label: `${target.kind === 'group' ? '🗂' : '📁'} ${target.kind === 'group' ? `В группу «${target.name}»` : target.name}`,
    action: () => void moveTask(t, target.id),
  }))]
}
async function moveTask(t: Task, targetId: string) {
  try {
    const moved = await api.post<Task>(`/projects/${t.project_id}/tasks/${t.id}/move`, { project_id: targetId })
    if (isGroup.value) tasks.value = tasks.value.map(x => x.id === t.id ? moved : x)
    else tasks.value = tasks.value.filter(x => x.id !== t.id)
    appStore.toast(`«${t.key}» перенесена в «${projectsStore.byId(targetId)?.name}»`, 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function markDoneTaskCard(t: Task) {
  if (!(await appStore.confirm(`Отметить задачу «${t.key}» выполненной? Плановый файл будет удалён.`, { confirmLabel: 'Отметить выполненной', danger: false }))) return
  try {
    const updated = await api.post<Task>(`/projects/${t.project_id}/tasks/${t.id}/done`, {})
    tasks.value = tasks.value.map(x => x.id === t.id ? updated : x)
    appStore.toast('Задача завершена', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function reopenTaskCard(t: Task) {
  try {
    const updated = await api.post<Task>(`/projects/${t.project_id}/tasks/${t.id}/reopen`, {})
    tasks.value = tasks.value.map(x => x.id === t.id ? updated : x)
    appStore.toast(`«${t.key}» снова в работе`, 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function deleteTaskCard(t: Task) {
  if (!(await appStore.confirm(`Удалить задачу «${t.key}»? Действие необратимо.`))) return
  try {
    await api.delete(`/projects/${t.project_id}/tasks/${t.id}`)
    tasks.value = tasks.value.filter(x => x.id !== t.id)
    appStore.toast('Задача удалена', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

</script>

<style scoped>
.home { height: 100%; display: flex; flex-direction: column; }
.project-area { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.project-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: calc(var(--titlebar-h) + var(--sp-3)) var(--sp-6) var(--sp-3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.project-title { min-width: 0; }
.project-header-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.title-icon { margin-right: 8px; }
.crumb { background: none; border: none; padding: 0; margin-right: 6px; color: var(--text-muted); font: inherit; cursor: pointer; }
.crumb:hover { color: var(--blue-hover); }
.project-key { margin-right: 6px; color: var(--text); }
.project-header h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 2px; }
.repo-path {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 2px;
  padding: 0 var(--sp-6);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 11px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}
.tab-btn:hover:not(:disabled) { color: var(--text); }
.tab-btn.active { color: var(--text); border-bottom-color: var(--blue); }
.tab-btn.disabled, .tab-btn:disabled { opacity: 0.35; cursor: default; }

/* Tab content panels */
.tab-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Terminal tab */
.terminal-tab { overflow: hidden; }

.ql-controls {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.ql-select { flex: 1; max-width: 280px; }

.minimized-bar { flex-shrink: 0; }
.minimized-item {
  padding: 6px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}
.minimized-label {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-toggle-btn {
  width: 96px;
  flex: 0 0 96px;
}

.terminal-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.terminal-slot { flex: 1; overflow: hidden; }

/* Tasks tab */
.tasks-tab { overflow: hidden; }

.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.task-list {
  flex: 1;
  padding: var(--sp-4) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  overflow-y: auto;
}

.task-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  transition: border-color 0.12s, background 0.12s;
}
.task-card:hover { border-color: var(--border-strong); background: var(--bg3); }
.task-key {
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  min-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-owner { flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: 11px; color: var(--text-muted); }
.task-owner.own { color: var(--blue-hover); border-color: var(--blue-soft); }
.task-menu { opacity: 0; transition: opacity 0.12s; }
.task-card:hover .task-menu, .task-menu:has(.menu.open) { opacity: 1; }
.task-filter { width: 190px; }
.task-search { width: 200px; height: var(--size-md); padding: 0 10px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 13px; }
.task-search:focus { outline: none; border-color: var(--blue); }

.task-act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.task-act svg { width: 16px; height: 16px; }
.task-card:hover .task-act { opacity: 0.75; }
.task-act:hover { opacity: 1; }
.task-del { color: var(--danger-hover); }
.task-del:hover { background: var(--danger-soft); }
.task-done { color: var(--accent-hover); }
.task-done:hover { background: var(--accent-soft); }
.task-reopen { color: var(--blue-hover); }
.task-reopen:hover { background: var(--blue-soft); }
.task-act + .task-del { margin-left: -8px; }

/* Placeholder tabs */
.placeholder-tab {
  align-items: center;
  justify-content: center;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}
.placeholder-icon { font-size: 32px; }
.placeholder-title { font-size: 15px; font-weight: 600; color: var(--text); }
.placeholder-text { font-size: 13px; }
.instructions-tab { overflow: hidden; }

.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
