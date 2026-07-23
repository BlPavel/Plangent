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
        <AppButton variant="ghost" size="sm" @click="openEditProject">Настройки проекта</AppButton>
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

      <!-- Tab: Терминал -->
      <div v-show="activeTab === 'terminal'" class="tab-content terminal-tab">
        <div class="ql-controls">
          <AppSelect v-model="quickAgentId" :options="agentOptions" placeholder="Агент" class="ql-select" />
          <AppSelect v-if="quickModelChoices.length" v-model="quickModel" :options="quickModelChoices" placeholder="Модель" class="ql-select" />
          <AppSelect v-if="quickReasoningChoices.length" v-model="quickReasoning" :options="quickReasoningChoices" placeholder="Рассуждения" class="ql-select" />
          <AppButton
            variant="primary"
            :disabled="!quickAgentId || quickLaunching"
            @click="quickLaunch"
          >{{ quickLaunching ? 'Запуск...' : '▶ Запустить' }}</AppButton>
        </div>

        <!-- Minimized sessions -->
        <div v-if="minimizedSessions.length" class="minimized-bar">
          <div v-for="s in minimizedSessions" :key="s.id" class="minimized-item">
            <span class="minimized-label">{{ s.label }}</span>
            <AppButton class="terminal-toggle-btn" variant="ghost" size="sm" @click="termStore.setActive(s.id)">Развернуть</AppButton>
            <AppButton variant="danger" size="sm" @click="killSession(s.id)">Завершить</AppButton>
          </div>
        </div>

        <!-- No sessions placeholder -->
        <div v-if="!projectSessions.length" class="terminal-empty">
          Выберите агента и нажмите «Запустить»
        </div>

        <!-- Terminal panes — all mounted, switched with v-show -->
        <div
          v-for="s in projectSessions"
          :key="s.id"
          v-show="s.id === termStore.activeSessionId"
          class="terminal-slot"
        >
          <TerminalPane
            :session-id="s.id"
            :label="s.label"
            :visible="s.id === termStore.activeSessionId && activeTab === 'terminal'"
            @detach="termStore.setActive(null)"
            @kill="killSession(s.id)"
            @input="sendInput(s.id, $event)"
          />
        </div>
      </div>

      <!-- Tab: Задачи -->
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
            <button class="task-del" title="Удалить задачу" @click.stop="deleteTaskCard(t)">
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
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '../stores/projects'
import { useAgentsStore } from '@features/agents'
import { useTerminalStore } from '@features/tasks'
import { api } from '@core/api'
import type { Task } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { TerminalPane } from '@features/tasks'
import { SkillsManager } from '@features/library'
import { hasPlaceholder } from '@shared/agent-placeholders'

const router = useRouter()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()
const termStore = useTerminalStore()

const currentProject = computed(() => appStore.currentProject)
const agents = computed(() => agentsStore.agents)
const agentOptions = computed(() => agents.value.map(a => ({ value: a.id, label: a.name })))
const tasks = ref<Task[]>([])

const activeTab = ref<'terminal' | 'tasks' | 'instructions' | 'integrations' | 'docs'>('tasks')
const tabs = [
  { id: 'terminal', label: 'Терминал', disabled: false },
  { id: 'tasks', label: 'Задачи', disabled: false },
  { id: 'instructions', label: 'Инструкции', disabled: false },
  { id: 'integrations', label: 'Интеграции', disabled: true },
  { id: 'docs', label: 'Доки', disabled: true },
] as const

const projectSessions = computed(() =>
  termStore.sessions.filter(s => s.projectId === currentProject.value?.id)
)
const minimizedSessions = computed(() =>
  projectSessions.value.filter(s => s.id !== termStore.activeSessionId)
)

const showTaskModal = ref(false)
const showProjectModal = ref(false)
const taskForm = ref({ key: '', title: '' })
const projectForm = ref({ name: '', repo_path: '', default_agent_id: '' })

const quickAgentId = ref('')
const quickModelOverride = ref<string | null>(null)
const quickReasoningOverride = ref<string | null>(null)
const quickLaunching = ref(false)

// Per-run model/reasoning-effort override — only exposed once the selected agent's
// own args template has a {model}/{reasoning} placeholder AND the developer has
// defined at least one choice for it in Settings (Agent.model_options/reasoning_options).
const quickAgent = computed(() => agents.value.find(a => a.id === quickAgentId.value) ?? null)
const quickModelChoices = computed(() =>
  (hasPlaceholder(quickAgent.value?.args, '{model}') ? quickAgent.value!.model_options : [])
    .map(v => ({ value: v, label: v })),
)
const quickReasoningChoices = computed(() =>
  (hasPlaceholder(quickAgent.value?.args, '{reasoning}') ? quickAgent.value!.reasoning_options : [])
    .map(v => ({ value: v, label: v })),
)
const quickModel = computed({
  get: () => quickModelOverride.value ?? quickAgent.value?.model ?? '',
  set: v => { quickModelOverride.value = v },
})
const quickReasoning = computed({
  get: () => quickReasoningOverride.value ?? quickAgent.value?.reasoning_effort ?? '',
  set: v => { quickReasoningOverride.value = v },
})
watch(quickAgentId, () => { quickModelOverride.value = null; quickReasoningOverride.value = null })

onMounted(() => agentsStore.load())

watch(currentProject, () => { loadTasks() }, { immediate: true })

watch(agents, (list) => {
  if (!quickAgentId.value && list.length) {
    quickAgentId.value = currentProject.value?.default_agent_id ?? list[0]?.id ?? ''
  }
}, { immediate: true })

async function loadTasks() {
  if (!currentProject.value) return
  tasks.value = await api.get<Task[]>(`/projects/${currentProject.value.id}/tasks`)
}

function statusLabel(s: string) {
  return { open: 'Открыта', in_progress: 'В работе', done: 'Готово' }[s] ?? s
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
  projectForm.value = { name: p.name, repo_path: p.repo_path, default_agent_id: p.default_agent_id ?? '' }
  showProjectModal.value = true
}

async function saveProject() {
  if (!currentProject.value) return
  try {
    const updated = await projectsStore.update(currentProject.value.id, {
      ...projectForm.value,
      default_agent_id: projectForm.value.default_agent_id || null,
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

async function quickLaunch() {
  if (!currentProject.value || !quickAgentId.value) return
  quickLaunching.value = true
  const sessionId = `quick-${currentProject.value.id.slice(0, 8)}-${Date.now()}`
  const agent = agents.value.find(a => a.id === quickAgentId.value)
  try {
    await api.post('/terminal/sessions', {
      id: sessionId,
      agentId: quickAgentId.value,
      projectId: currentProject.value.id,
      model: quickModel.value || undefined,
      reasoning_effort: quickReasoning.value || undefined,
    })
    const agentName = agent?.name ?? sessionId
    const sameCount = projectSessions.value.filter(s => s.label.startsWith(agentName)).length + 1
    const label = `${agentName} #${sameCount} — ${currentProject.value.name}`
    termStore.addSession({ id: sessionId, label, projectId: currentProject.value.id })
    appStore.toast('Агент запущен', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    quickLaunching.value = false
  }
}

async function killSession(id: string) {
  if (!(await appStore.confirm('Завершить сессию?', { confirmLabel: 'Завершить' }))) return
  try { await api.delete(`/terminal/sessions/${id}`) } catch {}
  termStore.removeSession(id)
}

function sendInput(sessionId: string, text: string) {
  api.post(`/terminal/sessions/${sessionId}/input`, { text }).catch(() => {})
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

.task-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  color: var(--danger-hover);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.task-del svg { width: 16px; height: 16px; }
.task-card:hover .task-del { opacity: 0.75; }
.task-del:hover { opacity: 1; background: var(--danger-soft); }

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
