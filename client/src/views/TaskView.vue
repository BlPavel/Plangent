<template>
  <div class="task-view">
    <div class="task-header">
      <button class="btn btn-ghost btn-sm" @click="goBack">← Назад</button>
      <div class="task-title-block">
        <code class="task-key">{{ task?.key }}</code>
        <span class="task-name">{{ task?.title }}</span>
      </div>
      <div class="actions">
        <select v-model="selectedAgentId" class="agent-select">
          <option value="">— выбрать агента —</option>
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <button class="btn btn-primary" :disabled="!selectedAgentId || launching" @click="launchAgent">
          {{ launching ? 'Запуск...' : '▶ Запустить' }}
        </button>
      </div>
    </div>

    <div class="task-body">
      <!-- Plan -->
      <section class="panel">
        <div class="panel-header">
          <h3>План</h3>
          <button class="btn btn-ghost btn-sm" @click="togglePlanEdit">
            {{ editingPlan ? 'Отмена' : 'Редактировать' }}
          </button>
        </div>

        <div v-if="!editingPlan">
          <div v-if="!plan" class="empty-state small">
            Нет плана. Запустите агента — он составит план автоматически.
          </div>
          <div v-else>
            <div class="progress-line">
              <span>{{ doneCount }}/{{ plan.steps.length }} шагов</span>
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progressPct + '%' }" />
              </div>
            </div>
            <div class="steps">
              <div
                v-for="s in plan.steps"
                :key="s.index"
                class="step"
                :class="{ done: s.done }"
              >
                <button class="step-check" :class="{ done: s.done }" @click="!s.done && markDone(s.index)">
                  {{ s.done ? '✓' : '' }}
                </button>
                <span>{{ s.text }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="plan-editor-wrap">
          <textarea v-model="planContent" class="plan-editor" placeholder="# Введите план в markdown...&#10;&#10;- [ ] Шаг 1&#10;- [ ] Шаг 2" />
          <div class="plan-actions">
            <button class="btn btn-primary btn-sm" @click="savePlan">Сохранить</button>
            <button class="btn btn-ghost btn-sm" @click="editingPlan = false">Отмена</button>
          </div>
        </div>
      </section>

      <!-- Runs -->
      <section class="panel">
        <h3>История запусков</h3>
        <div class="runs">
          <div v-if="!runs.length" class="empty-state small">Нет запусков</div>
          <div v-for="r in runs" :key="r.id" class="run-item">
            <div class="run-head">
              <span class="run-agent">{{ r.agent_name }}</span>
              <span class="run-date">{{ fmtDate(r.started_at) }}</span>
              <span class="run-status" :class="r.status">{{ statusLabel(r.status) }}</span>
              <button
                v-if="r.status === 'running'"
                class="btn btn-ghost btn-sm"
                @click="attachRun(r.id)"
              >Подключиться</button>
            </div>
            <div v-if="r.completed_steps.length" class="run-steps">
              Выполнено: {{ r.completed_steps.join(', ') }}
            </div>
            <div v-if="r.notes" class="run-steps">{{ r.notes }}</div>
          </div>
        </div>
      </section>
    </div>

    <!-- Minimized session bars -->
    <div v-for="s in minimizedSessions" :key="s.id" class="terminal-minimized">
      <span class="terminal-minimized-label">{{ s.label }}</span>
      <button class="btn btn-ghost btn-sm" @click="activeSessionId = s.id">Развернуть</button>
      <button class="btn btn-danger btn-sm" @click="killSession(s.id)">Завершить</button>
    </div>

    <!-- Terminal panes — all mounted, only active visible -->
    <div v-for="s in sessions" :key="s.id" v-show="s.id === activeSessionId" class="terminal-section">
      <TerminalPane
        :session-id="s.id"
        :label="s.label"
        :visible="s.id === activeSessionId"
        @detach="activeSessionId = null"
        @kill="killSession(s.id)"
        @input="sendInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAgentsStore } from '@/stores/agents'
import { api } from '@/api'
import type { Task, Plan, Run, RunStartResult } from '@/api/types'
import TerminalPane from '@/components/TerminalPane.vue'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const agentsStore = useAgentsStore()

const task = ref<Task | null>(appStore.currentTask)
const plan = ref<Plan | null>(null)
const runs = ref<Run[]>([])
const agents = computed(() => agentsStore.agents)
const selectedAgentId = ref(appStore.currentProject?.default_agent_id ?? '')
const launching = ref(false)
const editingPlan = ref(false)
const planContent = ref('')
interface TaskSession { id: string; label: string; runId: string }
const sessions = ref<TaskSession[]>([])
const activeSessionId = ref<string | null>(null)
const activeSession = computed(() => sessions.value.find(s => s.id === activeSessionId.value) ?? null)
const minimizedSessions = computed(() => sessions.value.filter(s => s.id !== activeSessionId.value))

const doneCount = computed(() => plan.value?.steps.filter(s => s.done).length ?? 0)
const progressPct = computed(() => {
  if (!plan.value?.steps.length) return 0
  return Math.round((doneCount.value / plan.value.steps.length) * 100)
})

const pid = computed(() => appStore.currentProject?.id)
const tid = computed(() => task.value?.id)

async function loadTask() {
  const taskId = route.params.id as string
  if (!pid.value) return
  task.value = await api.get<Task>(`/projects/${pid.value}/tasks/${taskId}`)
  appStore.currentTask = task.value
}

async function loadPlan() {
  if (!pid.value || !tid.value) return
  try {
    plan.value = await api.get<Plan>(`/projects/${pid.value}/tasks/${tid.value}/plans/latest`)
  } catch { plan.value = null }
}

async function loadRuns() {
  if (!pid.value || !tid.value) return
  runs.value = await api.get<Run[]>(`/projects/${pid.value}/tasks/${tid.value}/runs`)
}

onMounted(async () => {
  await loadTask()
  await Promise.all([loadPlan(), loadRuns(), agentsStore.load()])
  if (!selectedAgentId.value && agents.value.length) {
    selectedAgentId.value = agents.value[0].id
  }
})

function goBack() {
  sessions.value = []
  activeSessionId.value = null
  router.push('/')
}

async function launchAgent() {
  if (!pid.value || !tid.value || !selectedAgentId.value) return
  launching.value = true
  try {
    const result = await api.post<RunStartResult>(
      `/projects/${pid.value}/tasks/${tid.value}/runs`,
      { agent_id: selectedAgentId.value },
    )
    const agent = agents.value.find(a => a.id === selectedAgentId.value)
    appStore.toast(`Агент запущен (${result.mode}: ${result.session_id})`, 'success')
    const agentName = agent?.name ?? result.session_id
    const sameCount = sessions.value.filter(s => s.label.startsWith(agentName)).length + 1
    const label = `${agentName} #${sameCount} — ${task.value?.key ?? ''}`
    sessions.value.push({ id: result.session_id, label, runId: result.run.id })
    activeSessionId.value = result.session_id

    // Create PTY session via API if in PTY mode
    if (result.mode === 'pty') {
      // PTY session already created by the server, just connect
    } else if (result.mode === 'tmux') {
      // Wrap tmux attach in a PTY session so WS terminal works
      await api.post('/terminal/sessions', {
        id: result.session_id,
        cmd: 'tmux',
        args: ['attach-session', '-t', result.session_id],
        cwd: appStore.currentProject?.repo_path ?? '/',
      }).catch(() => {}) // may already exist
    }

    await loadRuns()
    setTimeout(loadPlan, 6000)
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    launching.value = false
  }
}

async function attachRun(runId: string) {
  if (!pid.value || !tid.value) return
  const run = runs.value.find(r => r.id === runId)
  if (!run) return
  // If we already have this run in sessions, just activate it
  const existing = sessions.value.find(s => s.runId === runId)
  if (existing) { activeSessionId.value = existing.id; return }
  const sessionId = `plangent-${task.value!.key.replace(/[^a-zA-Z0-9]/g, '-')}-${runId.slice(0, 8)}`
  const label = `${run.agent_name} — ${task.value?.key ?? ''}`
  sessions.value.push({ id: sessionId, label, runId })
  activeSessionId.value = sessionId
}

async function killSession(id: string) {
  const s = sessions.value.find(sess => sess.id === id)
  if (!s || !pid.value || !tid.value) return
  if (!confirm('Завершить сессию агента?')) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${s.runId}/kill`, {})
    appStore.toast('Агент остановлен')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
  sessions.value = sessions.value.filter(sess => sess.id !== id)
  if (activeSessionId.value === id) {
    activeSessionId.value = sessions.value[sessions.value.length - 1]?.id ?? null
  }
  await loadRuns()
  await loadPlan()
}

async function sendInput(text: string) {
  const s = activeSession.value
  if (!pid.value || !tid.value || !s) return
  await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${s.runId}/input`, { text })
}

// Plan editing
function togglePlanEdit() {
  editingPlan.value = !editingPlan.value
  if (editingPlan.value) planContent.value = plan.value?.content ?? ''
}

async function savePlan() {
  if (!pid.value || !tid.value) return
  try {
    if (plan.value) {
      plan.value = await api.patch<Plan>(
        `/projects/${pid.value}/tasks/${tid.value}/plans/${plan.value.id}`,
        { content: planContent.value },
      )
    } else {
      plan.value = await api.post<Plan>(
        `/projects/${pid.value}/tasks/${tid.value}/plans`,
        { content: planContent.value },
      )
    }
    editingPlan.value = false
    appStore.toast('План сохранён', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function markDone(stepIndex: number) {
  if (!plan.value || !pid.value || !tid.value) return
  plan.value = await api.post<Plan>(
    `/projects/${pid.value}/tasks/${tid.value}/plans/${plan.value.id}/step/${stepIndex}/done`,
    {},
  )
}

function statusLabel(s: string) {
  return { running: 'Выполняется', completed: 'Завершён', failed: 'Ошибка', interrupted: 'Прерван' }[s] ?? s
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.task-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.task-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.task-title-block { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.task-key { font-size: 13px; color: var(--text-muted); }
.task-name { font-size: 15px; font-weight: 600; }

.agent-select {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}

.task-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.panel {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.panel h3 { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

.progress-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
.progress-bar { flex: 1; height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }

.steps { display: flex; flex-direction: column; gap: 6px; }
.step { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.step.done { color: var(--text-muted); text-decoration: line-through; }
.step-check {
  width: 16px; height: 16px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px;
  flex-shrink: 0;
  color: white;
  transition: background 0.1s;
}
.step-check:not(.done):hover { background: var(--bg3); }
.step-check.done { background: var(--accent); border-color: var(--accent); }

.plan-editor-wrap { display: flex; flex-direction: column; gap: 8px; }
.plan-editor {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  padding: 10px;
  min-height: 160px;
  resize: vertical;
}
.plan-editor:focus { outline: none; border-color: var(--blue); }
.plan-actions { display: flex; gap: 8px; }

.runs { display: flex; flex-direction: column; gap: 8px; }
.run-item {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.run-head { display: flex; align-items: center; gap: 8px; }
.run-agent { font-weight: 600; }
.run-date { color: var(--text-muted); margin-left: 4px; }
.run-status { margin-left: auto; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--border); }
.run-status.running { color: #e3b341; border-color: #e3b341; }
.run-status.completed { color: var(--accent); border-color: var(--accent); }
.run-status.failed { color: var(--danger); border-color: var(--danger); }
.run-steps { color: var(--text-muted); }

.terminal-section {
  border-top: 1px solid var(--border);
  height: 40vh;
  flex-shrink: 0;
}

.terminal-minimized {
  border-top: 1px solid var(--border);
  padding: 6px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg2);
  flex-shrink: 0;
}
.terminal-minimized-label {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
