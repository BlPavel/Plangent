<template>
  <div class="home">
    <div v-if="!currentProject" class="empty-state">
      <p>Выберите проект или создайте новый</p>
    </div>

    <div v-else class="project-area">
      <!-- Project header -->
      <div class="project-header app-drag">
        <div class="project-title">
          <h1>{{ currentProject.name }}</h1>
          <span class="repo-path">{{ currentProject.repo_path }}</span>
        </div>
        <div class="project-header-actions">
          <AppButton variant="ghost" size="sm" @click="openEditProject">Настройки проекта</AppButton>
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

      <div v-show="activeTab === 'agents'" class="tab-content"><AgentChats :project-id="currentProject.id" :default-agent-id="currentProject.default_agent_id" /></div>
      <div v-show="activeTab === 'terminal'" class="tab-content"><TerminalsView :project-id="currentProject.id" :visible="activeTab === 'terminal'" /></div>
      <div v-show="activeTab === 'tasks'" class="tab-content tasks-tab">
        <div class="task-actions">
          <AppButton variant="primary" @click="openCreateTask">+ Задача</AppButton>
        </div>
        <div class="task-list">
          <div v-if="!tasks.length" class="empty-state small">
            Нет задач. Создайте первую.
          </div>
          <div
            v-for="t in tasks"
            :key="t.id"
            class="task-card"
            @click="openTask(t)"
          >
            <code class="task-key">{{ t.key }}</code>
            <span class="task-title">{{ t.title || '—' }}</span>
            <StatusBadge :status="t.status" />
            <button v-if="t.status !== 'done'" class="task-act task-done" title="Завершить задачу" @click.stop="markDoneTaskCard(t)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
            </button>
            <button v-else class="task-act task-reopen" title="Вернуть в работу" @click.stop="reopenTaskCard(t)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v3h3" /></svg>
            </button>
            <button class="task-act task-del" title="Удалить задачу" @click.stop="deleteTaskCard(t)">
              <IconTrash />
            </button>
          </div>
        </div>
      </div>

      <!-- Tab: Инструкции -->
      <div v-show="activeTab === 'instructions'" class="tab-content instructions-tab">
        <SkillsManager v-if="currentProject" scope="project" :project-id="currentProject.id" />
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
    </AppModal>

    <!-- Edit project modal -->
    <AppModal v-model="showProjectModal" title="Настройки проекта" confirm-label="Сохранить" @confirm="saveProject">
      <FormField v-model="projectForm.name" label="Название" />
      <div class="form-field">
        <label>Путь к репозиторию</label>
        <FolderPicker v-model="projectForm.repo_path" />
      </div>
      <FormField v-model="projectForm.default_agent_id" label="Агент по умолчанию" type="select">
        <option value="">— выбрать —</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </FormField>
      <FormField
        v-model="projectForm.dangerous_commands"
        label="Опасные команды"
        type="textarea"
        :rows="3"
        placeholder="git push --force&#10;git reset --hard&#10;rm -rf&#10;git clean -fd"
        hint="По одной команде на строку. Даже в режиме «без вопросов» такая команда переведёт сессию в «ждёт вас»."
      />
    </AppModal>
  </div>
</template>

<script lang="ts">
type HomeTab = 'agents' | 'terminal' | 'tasks' | 'instructions' | 'integrations' | 'docs'
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
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { SkillsManager } from '@features/library'

const router = useRouter()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

const currentProject = computed(() => appStore.currentProject)
const agents = computed(() => agentsStore.agents)
const tasks = ref<Task[]>([])

// A freshly opened project starts on «Агенты»; coming back from a task restores the tab you left.
const activeTab = ref<HomeTab>(lastTab.projectId && lastTab.projectId === appStore.currentProject?.id ? lastTab.tab : 'agents')
watch(activeTab, tab => { if (currentProject.value) Object.assign(lastTab, { projectId: currentProject.value.id, tab }) }, { immediate: true })
const tabs = [
  { id: 'agents', label: '\u0410\u0433\u0435\u043d\u0442\u044b', disabled: false },
  { id: 'terminal', label: 'Терминал', disabled: false },
  { id: 'tasks', label: 'Задачи', disabled: false },
  { id: 'instructions', label: 'Инструкции', disabled: false },
  { id: 'integrations', label: 'Интеграции', disabled: true },
  { id: 'docs', label: 'Доки', disabled: true },
] as const

const showTaskModal = ref(false)
const showProjectModal = ref(false)
const taskForm = ref({ key: '', title: '' })
const projectForm = ref({ name: '', repo_path: '', default_agent_id: '', dangerous_commands: '' })

onMounted(() => agentsStore.load())

watch(currentProject, () => { loadTasks() }, { immediate: true })
watch(() => currentProject.value?.id, id => {
  activeTab.value = 'agents'
  Object.assign(lastTab, { projectId: id ?? null, tab: 'agents' })
})


async function loadTasks() {
  if (!currentProject.value) return
  tasks.value = await api.get<Task[]>(`/projects/${currentProject.value.id}/tasks`)
}


function openCreateTask() {
  taskForm.value = { key: '', title: '' }
  showTaskModal.value = true
}

async function createTask() {
  if (!currentProject.value || !taskForm.value.key) return
  const duplicate = tasks.value.some(t => t.key === taskForm.value.key)
  if (duplicate) {
    appStore.toast(`Ключ «${taskForm.value.key}» уже занят`, 'error')
    return
  }
  try {
    const t = await api.post<Task>(`/projects/${currentProject.value.id}/tasks`, taskForm.value)
    tasks.value.unshift(t)
    appStore.toast('Задача создана', 'success')
    showTaskModal.value = false
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

function openEditProject() {
  const p = currentProject.value!
  projectForm.value = {
    name: p.name,
    repo_path: p.repo_path,
    default_agent_id: p.default_agent_id ?? '',
    dangerous_commands: (p.config.dangerous_commands ?? []).join('\n'),
  }
  showProjectModal.value = true
}

async function deleteProject() {
  const p = currentProject.value
  if (!p) return
  const ok = await appStore.confirm(
    `Удалить проект «${p.name}»? Все его задачи, чаты и настройки будут удалены безвозвратно.`,
    { confirmLabel: 'Удалить', danger: true }
  )
  if (!ok) return
  try {
    await projectsStore.remove(p.id)
    appStore.currentProject = projectsStore.projects[0] ?? null
    appStore.toast('Проект удалён', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function saveProject() {
  if (!currentProject.value) return
  try {
    const { dangerous_commands, ...form } = projectForm.value
    const updated = await projectsStore.update(currentProject.value.id, {
      ...form,
      default_agent_id: projectForm.value.default_agent_id || null,
      config: {
        ...currentProject.value.config,
        dangerous_commands: dangerous_commands.split('\n').map(s => s.trim()).filter(Boolean),
      },
    })
    appStore.currentProject = updated
    appStore.toast('Сохранено', 'success')
    showProjectModal.value = false
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

function openTask(t: Task) {
  appStore.currentTask = t
  router.push(`/task/${t.id}`)
}

async function markDoneTaskCard(t: Task) {
  if (!currentProject.value) return
  if (!(await appStore.confirm(`Отметить задачу «${t.key}» выполненной? Плановый файл будет удалён.`, { confirmLabel: 'Отметить выполненной', danger: false }))) return
  try {
    const updated = await api.post<Task>(`/projects/${currentProject.value.id}/tasks/${t.id}/done`, {})
    tasks.value = tasks.value.map(x => x.id === t.id ? updated : x)
    appStore.toast('Задача завершена', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function reopenTaskCard(t: Task) {
  if (!currentProject.value) return
  try {
    const updated = await api.post<Task>(`/projects/${currentProject.value.id}/tasks/${t.id}/reopen`, {})
    tasks.value = tasks.value.map(x => x.id === t.id ? updated : x)
    appStore.toast(`«${t.key}» снова в работе`, 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function deleteTaskCard(t: Task) {
  if (!currentProject.value) return
  if (!(await appStore.confirm(`Удалить задачу «${t.key}»? Действие необратимо.`))) return
  try {
    await api.delete(`/projects/${currentProject.value.id}/tasks/${t.id}`)
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
.instructions-tab { overflow-y: auto; padding: var(--sp-5) var(--sp-6); }

.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
