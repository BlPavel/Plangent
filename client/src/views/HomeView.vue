<template>
  <div class="home">
    <div v-if="!currentProject" class="empty-state">
      <p>Выберите проект или создайте новый</p>
    </div>

    <div v-else class="project-area">
      <div class="project-header">
        <div>
          <h1>{{ currentProject.name }}</h1>
          <span class="muted">{{ currentProject.repo_path }}</span>
        </div>
        <div class="actions">
          <button class="btn btn-primary" @click="openCreateTask">+ Задача</button>
          <button class="btn btn-ghost" @click="openEditProject">Настройки</button>
        </div>
      </div>

      <div class="project-body" ref="bodyEl">
        <!-- Task list -->
        <div class="task-list" :style="{ width: leftWidth + 'px' }">
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
            <span class="task-status" :class="t.status">{{ statusLabel(t.status) }}</span>
          </div>
        </div>

        <!-- Resize handle -->
        <div class="resize-handle" @mousedown="startResize" />

        <!-- Quick launch panel -->
        <div class="quick-launch">
          <div class="ql-header">
            <h3>Быстрый запуск</h3>
            <span class="ql-hint">Запустить агента без задачи</span>
          </div>
          <div class="ql-controls">
            <select v-model="quickAgentId" class="agent-select">
              <option value="">— агент —</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button
              class="btn btn-primary btn-sm"
              :disabled="!quickAgentId || quickLaunching"
              @click="quickLaunch"
            >
              {{ quickLaunching ? 'Запуск...' : '▶ Запустить' }}
            </button>
          </div>

          <div v-if="quickSession" class="ql-terminal">
            <TerminalPane
              :session-id="quickSession"
              @detach="quickSession = null"
              @kill="killQuick"
              @input="sendQuickInput"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Create task modal -->
    <AppModal v-model="showTaskModal" title="Новая задача" @confirm="createTask">
      <FormField v-model="taskForm.key" label="Ключ задачи" placeholder="PROJ-123" />
      <FormField v-model="taskForm.title" label="Название" placeholder="Добавить авторизацию" />
      <FormField v-model="taskForm.description" label="Описание" type="textarea" :rows="4" placeholder="Что нужно сделать..." />
    </AppModal>

    <!-- Edit project modal -->
    <AppModal v-model="showProjectModal" title="Настройки проекта" @confirm="saveProject">
      <FormField v-model="projectForm.name" label="Название" />
      <div class="form-field">
        <label>Путь к репозиторию</label>
        <FolderPicker v-model="projectForm.repo_path" />
      </div>
      <FormField
        v-model="projectForm.default_agent_id"
        label="Агент по умолчанию"
        type="select"
      >
        <option value="">— выбрать —</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </FormField>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useProjectsStore } from '@/stores/projects'
import { useAgentsStore } from '@/stores/agents'
import { api } from '@/api'
import type { Task } from '@/api/types'
import AppModal from '@/components/AppModal.vue'
import FormField from '@/components/FormField.vue'
import FolderPicker from '@/components/FolderPicker.vue'
import TerminalPane from '@/components/TerminalPane.vue'

const router = useRouter()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

const currentProject = computed(() => appStore.currentProject)
const agents = computed(() => agentsStore.agents)
const tasks = ref<Task[]>([])

const showTaskModal = ref(false)
const showProjectModal = ref(false)

const taskForm = ref({ key: '', title: '', description: '' })
const projectForm = ref({ name: '', repo_path: '', default_agent_id: '' })

const quickAgentId = ref('')
const quickLaunching = ref(false)
const quickSession = ref<string | null>(null)

// Resize state
const bodyEl = ref<HTMLElement>()
const leftWidth = ref(0)
const MIN_LEFT = 200
const MIN_RIGHT = 260

let dragging = false
let startX = 0
let startWidth = 0

function startResize(e: MouseEvent) {
  dragging = true
  startX = e.clientX
  startWidth = leftWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onMouseMove(e: MouseEvent) {
  if (!dragging || !bodyEl.value) return
  const totalWidth = bodyEl.value.clientWidth - 5 // handle width
  const delta = e.clientX - startX
  const newLeft = Math.max(MIN_LEFT, Math.min(totalWidth - MIN_RIGHT, startWidth + delta))
  leftWidth.value = newLeft
}

function onMouseUp() {
  if (!dragging) return
  dragging = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(() => {
  agentsStore.load()
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  // Set initial left width after mount
  requestAnimationFrame(() => {
    if (bodyEl.value) {
      leftWidth.value = Math.round(bodyEl.value.clientWidth * 0.6)
    }
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})

watch(currentProject, () => {
  loadTasks()
  quickSession.value = null
}, { immediate: true })

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
  taskForm.value = { key: '', title: '', description: '' }
  showTaskModal.value = true
}

async function createTask() {
  if (!currentProject.value || !taskForm.value.key) return
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

async function quickLaunch() {
  if (!currentProject.value || !quickAgentId.value) return
  quickLaunching.value = true
  const sessionId = `quick-${currentProject.value.id.slice(0, 8)}-${Date.now()}`
  try {
    await api.post('/terminal/sessions', {
      id: sessionId,
      agentId: quickAgentId.value,
      projectId: currentProject.value.id,
    })
    quickSession.value = sessionId
    appStore.toast('Агент запущен', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    quickLaunching.value = false
  }
}

async function killQuick() {
  if (!quickSession.value) return
  if (!confirm('Завершить сессию?')) return
  try {
    await api.delete(`/terminal/sessions/${quickSession.value}`)
    quickSession.value = null
  } catch {}
}

function sendQuickInput(text: string) {
  if (!quickSession.value) return
  api.post(`/terminal/sessions/${quickSession.value}/input`, { text }).catch(() => {})
}
</script>

<style scoped>
.home { height: 100%; display: flex; flex-direction: column; }
.project-area { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.project-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.project-header h1 { font-size: 18px; }

.project-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
}

.task-list {
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex-shrink: 0;
}

/* Resize handle */
.resize-handle {
  width: 5px;
  flex-shrink: 0;
  background: var(--border);
  cursor: col-resize;
  transition: background 0.15s;
  position: relative;
}
.resize-handle:hover,
.resize-handle:active {
  background: var(--blue);
}

.task-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color 0.1s;
}
.task-card:hover { border-color: var(--blue); }
.task-key { font-size: 12px; color: var(--text-muted); min-width: 80px; }
.task-title { flex: 1; }
.task-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.task-status.open { border-color: var(--blue); color: var(--blue); }
.task-status.in_progress { border-color: #e3b341; color: #e3b341; }
.task-status.done { border-color: var(--accent); color: var(--accent); }

/* Quick launch */
.quick-launch {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.ql-header {
  padding: 16px 16px 10px;
  flex-shrink: 0;
}
.ql-header h3 { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
.ql-hint { font-size: 11px; color: var(--text-muted); }

.ql-controls {
  padding: 0 16px 12px;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.agent-select {
  flex: 1;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}

.ql-terminal { flex: 1; overflow: hidden; }

.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
