<template>
  <div class="task-view">
    <div class="task-header">
      <button class="btn btn-ghost btn-sm" @click="goBack">← Назад</button>
      <div class="task-title-block">
        <code class="task-key">{{ task?.key }}</code>
        <span class="task-name">{{ task?.title }}</span>
        <span class="task-status-badge" :class="task?.status">{{ statusLabel(task?.status ?? '') }}</span>
      </div>
      <div class="actions">
        <button
          v-if="task?.status !== 'done'"
          class="btn btn-ghost btn-sm"
          @click="markDoneTask"
        >✓ Завершить</button>
        <button class="btn btn-ghost btn-sm danger" @click="deleteCurrentTask">🗑 Удалить</button>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="task-tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'plan' }" @click="activeTab = 'plan'">План</button>
      <button class="tab-btn" :class="{ active: activeTab === 'exec' }" @click="activeTab = 'exec'">Выполнение</button>
    </div>

    <!-- Tab: План -->
    <div v-show="activeTab === 'plan'" class="tab-body">
      <!-- Planning in progress (agent session live) -->
      <div v-if="planningActive" class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="planning-status">
            <span class="planning-dot" />
            Идёт планирование с агентом
          </div>
          <button class="btn btn-primary btn-sm" @click="approvePlan">✓ Утвердить план</button>
        </div>
        <p class="plan-empty-hint">
          Опишите задачу агенту в терминале ниже — работают <code>@файлы</code>, перетаскивание и вставка.
          План появится здесь по мере написания. Когда план готов — нажмите «Утвердить».
        </p>
        <textarea
          v-if="plan?.content"
          :value="plan.content"
          class="plan-editor"
          readonly
        />
        <div v-else class="plan-waiting">Ожидаем план от агента…</div>
      </div>

      <!-- Empty state — no plan yet -->
      <div v-else-if="!plan && !editingPlan" class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="progress-line"><span>Плана пока нет</span></div>
          <div class="plan-header-actions">
            <select v-model="planningAgentId" class="agent-select agent-select-sm">
              <option value="" disabled>Агент</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button
              class="btn btn-primary btn-sm"
              :disabled="!planningAgentId || planningLaunching"
              @click="launchPlanning"
            >{{ planningLaunching ? 'Запуск...' : '▸ Составить план с агентом' }}</button>
            <button class="btn btn-ghost btn-sm" @click="startManualEdit">Написать вручную</button>
          </div>
        </div>
        <p class="plan-empty-hint">опишите задачу агенту в терминале — работают <code>@файлы</code>, перетаскивание и вставка файлов</p>
      </div>

      <!-- Plan editor (manual) -->
      <div v-else-if="editingPlan" class="plan-tab-content">
        <div class="plan-editor-wrap">
          <textarea v-model="planContent" class="plan-editor" placeholder="---&#10;plangent: 1&#10;key: KEY&#10;title: Title&#10;status: open&#10;---&#10;&#10;- [ ] (p1) Step 1&#10;- [ ] (p2) Step 2" />
          <div class="plan-actions">
            <button class="btn btn-primary btn-sm" @click="savePlan">Сохранить</button>
            <button class="btn btn-ghost btn-sm" @click="editingPlan = false">Отмена</button>
          </div>
        </div>
      </div>

      <!-- Plan view -->
      <div v-else class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="progress-line">
            <span>{{ doneCount }}/{{ plan!.steps.length }} шагов</span>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progressPct + '%' }" />
            </div>
          </div>
          <div class="plan-header-actions">
            <select v-model="planningAgentId" class="agent-select agent-select-sm">
              <option value="" disabled>Агент</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button
              class="btn btn-ghost btn-sm"
              :disabled="!planningAgentId || planningLaunching"
              @click="launchPlanning"
            >{{ planningLaunching ? 'Запуск...' : '▸ Изменить план с агентом' }}</button>
            <button class="btn btn-ghost btn-sm" @click="togglePlanEdit">Редактировать вручную</button>
          </div>
        </div>
        <div class="steps">
          <div
            v-for="s in plan!.steps"
            :key="s.id ?? s.index"
            class="step"
            :class="{ done: s.done }"
          >
            <span class="step-check readonly" :class="{ done: s.done }">
              {{ s.done ? '✓' : '' }}
            </span>
            <span class="step-id" v-if="s.id">{{ s.id }}</span>
            <span class="step-text">{{ s.text }}</span>
            <span v-if="s.parallelGroup" class="parallel-badge">⟂ {{ s.parallelGroup }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: Выполнение -->
    <div v-show="activeTab === 'exec'" class="tab-body exec-tab-body">
      <!-- Selectable steps (from plan) -->
      <div v-if="plan" class="exec-section">
        <div class="section-label">Шаги плана</div>
        <div class="steps">
          <div
            v-for="s in plan.steps"
            :key="s.id ?? s.index"
            class="step"
            :class="{ done: s.done, selected: isStepSelected(s) }"
            @click="toggleStepSelection(s)"
          >
            <button class="step-check" :class="{ done: s.done }" @click.stop="!s.done && markStepDone(s.index)">
              {{ s.done ? '✓' : '' }}
            </button>
            <span class="step-id" v-if="s.id">{{ s.id }}</span>
            <span class="step-text">{{ s.text }}</span>
            <span v-if="s.parallelGroup" class="parallel-badge">⟂ {{ s.parallelGroup }}</span>
          </div>
        </div>
      </div>
      <div v-else class="exec-no-plan">
        Нет плана. Создайте план на вкладке «План».
      </div>

      <!-- Queue builder -->
      <div v-if="task?.status !== 'done'" class="exec-section queue-builder">
        <div class="section-label">Очередь выполнения</div>
        <div class="builder-row">
          <select v-model="builderAgentId" class="agent-select">
            <option value="" disabled>Агент</option>
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <input
            v-model="builderParallelGroup"
            class="parallel-input"
            placeholder="parallel group (optional)"
          />
          <button
            class="btn btn-ghost btn-sm"
            :disabled="!builderAgentId || selectedStepIds.size === 0"
            @click="addQueueSession"
          >+ Добавить сессию</button>
        </div>
        <div class="selection-hint" v-if="selectedStepIds.size > 0">
          Выбрано шагов: {{ selectedStepIds.size }} — {{ [...selectedStepIds].join(', ') }}
        </div>
        <div class="selection-hint muted" v-else>
          Кликните по шагам плана чтобы выбрать их для сессии
        </div>
      </div>

      <!-- Queue list -->
      <div v-if="queueSessions.length > 0" class="exec-section">
        <div class="queue-list">
          <div
            v-for="(s, i) in queueSessions"
            :key="s.id"
            class="queue-item"
            :class="s.status"
          >
            <span class="queue-num">#{{ i + 1 }}</span>
            <span class="queue-agent">{{ agentName(s.agentId) }}</span>
            <span class="queue-points">{{ s.points.join(', ') }}</span>
            <span v-if="s.parallelGroup" class="parallel-badge">⟂ {{ s.parallelGroup }}</span>
            <span class="queue-status-chip" :class="s.status">{{ sessionStatusLabel(s.status) }}</span>
            <button
              v-if="s.status === 'waiting_for_developer'"
              class="btn btn-ghost btn-sm"
              @click="advanceSession(s.id)"
            >Продолжить →</button>
            <button
              v-if="s.status === 'queued'"
              class="btn btn-ghost btn-xs danger"
              @click="removeQueueSession(i)"
            >✕</button>
          </div>
        </div>
        <div class="queue-actions" v-if="queueSessions.some(s => s.status === 'queued') && task?.status !== 'done'">
          <button
            class="btn btn-primary"
            :disabled="executing || queueSessions.filter(s => s.status === 'queued').length === 0"
            @click="runQueue"
          >
            {{ executing ? 'Выполняется...' : '▶ Запустить очередь' }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="clearQueuedSessions">Очистить</button>
        </div>
      </div>

      <!-- Run history -->
      <div class="exec-section runs-section">
        <div class="section-label">История запусков</div>
        <div class="runs">
          <div v-if="!runs.length" class="empty-state small">Нет запусков</div>
          <div v-for="r in runs" :key="r.id" class="run-item">
            <div class="run-head">
              <span class="run-agent">{{ r.agent_name }}</span>
              <span class="run-date">{{ fmtDate(r.started_at) }}</span>
              <span class="run-status" :class="r.status">{{ runStatusLabel(r.status) }}</span>
              <button
                v-if="r.status === 'running'"
                class="btn btn-ghost btn-sm"
                @click="attachRun(r.id)"
              >Подключиться</button>
            </div>
            <div v-if="r.notes" class="run-notes">{{ r.notes }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Global terminal dock (shared across both tabs) -->
    <div v-for="s in minimizedSessions" :key="s.id" class="terminal-minimized">
      <span class="terminal-minimized-label">{{ s.label }}</span>
      <span v-if="sessionIsWaiting(s.id)" class="waiting-badge">⚠ ожидает ввода</span>
      <button class="btn btn-ghost btn-sm" @click="activeSessionId = s.id">Развернуть</button>
      <button class="btn btn-danger btn-sm" @click="killSession(s.id)">Завершить</button>
    </div>

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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAgentsStore } from '@/stores/agents'
import { useTaskSessionStore } from '@/stores/taskSession'
import { api } from '@/api'
import type {
  Task, Plan, Run, RunStartResult,
  PlanStep, OrchestratorQueueSession, OrchestratorResponse,
  OrchestratorEvent, ExecuteResponse,
} from '@/api/types'
import TerminalPane from '@/components/TerminalPane.vue'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const sessionStore = useTaskSessionStore()

const task = ref<Task | null>(appStore.currentTask)
const plan = ref<Plan | null>(null)
const runs = ref<Run[]>([])
const agents = computed(() => agentsStore.agents)
const executing = ref(false)
const editingPlan = ref(false)
const planContent = ref('')

const activeTab = ref<'plan' | 'exec'>('plan')

// Planning launch state
const planningAgentId = ref(appStore.currentProject?.default_agent_id ?? '')
const planningLaunching = ref(false)
const planningActive = ref(false)
const planningRunId = ref<string | null>(null)
const planningSessionId = ref<string | null>(null)

// Queue builder state
const builderAgentId = ref(appStore.currentProject?.default_agent_id ?? '')
const builderParallelGroup = ref('')
const selectedStepIds = ref<Set<string>>(new Set())
const queueSessions = ref<OrchestratorQueueSession[]>([])

interface TaskSession { id: string; label: string; runId: string }
const sessions = ref<TaskSession[]>([])
const activeSessionId = ref<string | null>(null)
const activeSession = computed(() => sessions.value.find(s => s.id === activeSessionId.value) ?? null)
const minimizedSessions = computed(() => sessions.value.filter(s => s.id !== activeSessionId.value))
const waitingSessionIds = ref<Set<string>>(new Set())

const doneCount = computed(() => plan.value?.steps.filter(s => s.done).length ?? 0)
const progressPct = computed(() => {
  if (!plan.value?.steps.length) return 0
  return Math.round((doneCount.value / plan.value.steps.length) * 100)
})

const pid = computed(() => appStore.currentProject?.id)
const tid = computed(() => task.value?.id)

let eventsWs: WebSocket | null = null

function connectEvents() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws/events`
  eventsWs = new WebSocket(wsUrl)

  eventsWs.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data) as OrchestratorEvent
      if (!('taskId' in event) || event.taskId !== tid.value) return
      handleOrchestratorEvent(event)
    } catch {}
  }

  eventsWs.onclose = () => {
    setTimeout(() => { if (tid.value) connectEvents() }, 2000)
  }
}

async function handleOrchestratorEvent(event: OrchestratorEvent) {
  switch (event.type) {
    case 'session_started': {
      executing.value = true
      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
      if (queueSess) queueSess.status = 'running'
      addTerminalSession(event.terminalSessionId, event.runId)
      break
    }
    case 'session_complete': {
      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
      if (queueSess) queueSess.status = 'complete'
      if (event.runId) waitingSessionIds.value.delete(event.runId)
      loadRuns()
      break
    }
    case 'session_waiting': {
      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
      if (queueSess) queueSess.status = 'waiting_for_developer'
      if (event.terminalSessionId) {
        waitingSessionIds.value.add(event.terminalSessionId)
        activeSessionId.value = event.terminalSessionId
      }
      appStore.toast(event.message, 'warning')
      break
    }
    case 'session_failed': {
      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
      if (queueSess) queueSess.status = 'failed'
      appStore.toast(`Сессия завершилась с ошибкой: ${event.reason}`, 'error')
      executing.value = false
      break
    }
    case 'queue_finished': {
      executing.value = false
      appStore.toast('Очередь выполнена. Проверьте изменения и закоммитьте.', 'success')
      loadRuns()
      loadPlan()
      break
    }
    case 'run_failed': {
      executing.value = false
      appStore.toast(`Ошибка выполнения: ${event.reason}`, 'error')
      break
    }
    case 'task_status': {
      if (task.value) task.value = { ...task.value, status: event.status }
      break
    }
    case 'plan_updated': {
      // During planning we need the full content live; reload to get content + steps.
      if (planningActive.value || !plan.value) {
        await loadPlan()
        activeTab.value = 'plan'
      } else {
        plan.value = { ...plan.value, steps: event.steps as PlanStep[] }
      }
      break
    }
  }
}

function addTerminalSession(terminalSessionId: string, runId: string) {
  if (sessions.value.some(s => s.id === terminalSessionId)) {
    activeSessionId.value = terminalSessionId
    return
  }
  const label = `Session — ${task.value?.key ?? ''}`
  sessions.value.push({ id: terminalSessionId, label, runId })
  activeSessionId.value = terminalSessionId
}

function sessionIsWaiting(terminalSessionId: string): boolean {
  return waitingSessionIds.value.has(terminalSessionId)
}

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

async function loadOrchestratorState() {
  if (!pid.value || !tid.value) return
  try {
    const resp = await api.get<OrchestratorResponse>(`/projects/${pid.value}/tasks/${tid.value}/orchestrator`)
    if (resp.active && resp.state) {
      queueSessions.value = resp.state.sessions
      executing.value = resp.state.status === 'running'
    }
  } catch {}
}

onMounted(async () => {
  await loadTask()
  restoreSessions()
  await Promise.all([loadPlan(), loadRuns(), agentsStore.load(), loadOrchestratorState()])
  if (!planningAgentId.value && agents.value.length) planningAgentId.value = agents.value[0].id
  if (!builderAgentId.value && agents.value.length) builderAgentId.value = agents.value[0].id
  connectEvents()
})

onUnmounted(() => {
  if (eventsWs) { eventsWs.onclose = null; eventsWs.close() }
  // Persist live terminal/planning state so returning to the task re-attaches the
  // still-running agent instead of losing it.
  saveSessions()
})

// Restore terminal sessions + planning state for this task (if we visited it before).
function restoreSessions() {
  if (!tid.value) return
  const snap = sessionStore.load(tid.value)
  if (!snap) return
  sessions.value = snap.sessions.map(s => ({ ...s }))
  activeSessionId.value = snap.activeSessionId
  waitingSessionIds.value = new Set(snap.waitingSessionIds)
  planningActive.value = snap.planningActive
  planningRunId.value = snap.planningRunId
  planningSessionId.value = snap.planningSessionId
}

function saveSessions() {
  if (!tid.value) return
  sessionStore.save(tid.value, {
    sessions: sessions.value.map(s => ({ ...s })),
    activeSessionId: activeSessionId.value,
    waitingSessionIds: [...waitingSessionIds.value],
    planningActive: planningActive.value,
    planningRunId: planningRunId.value,
    planningSessionId: planningSessionId.value,
  })
}

function goBack() {
  // Keep the agent and its terminal alive; onUnmounted saves the snapshot so the
  // session is restored when the developer comes back.
  router.push('/')
}

// ——— Step selection (for execution queue) ———

function isStepSelected(s: PlanStep): boolean {
  return s.id ? selectedStepIds.value.has(s.id) : false
}

function toggleStepSelection(s: PlanStep) {
  if (!s.id || s.done) return
  if (selectedStepIds.value.has(s.id)) {
    selectedStepIds.value.delete(s.id)
  } else {
    selectedStepIds.value.add(s.id)
  }
  selectedStepIds.value = new Set(selectedStepIds.value)
}

// ——— Queue builder ———

function addQueueSession() {
  if (!builderAgentId.value || selectedStepIds.value.size === 0) return
  queueSessions.value.push({
    id: crypto.randomUUID(),
    points: [...selectedStepIds.value],
    agentId: builderAgentId.value,
    parallelGroup: builderParallelGroup.value.trim() || null,
    status: 'queued',
  })
  selectedStepIds.value = new Set()
  builderParallelGroup.value = ''
}

function removeQueueSession(index: number) {
  queueSessions.value.splice(index, 1)
}

function clearQueuedSessions() {
  queueSessions.value = queueSessions.value.filter(s => s.status !== 'queued')
}

async function runQueue() {
  if (!pid.value || !tid.value) return
  const toRun = queueSessions.value.filter(s => s.status === 'queued')
  if (!toRun.length) return
  executing.value = true
  try {
    await api.post<ExecuteResponse>(
      `/projects/${pid.value}/tasks/${tid.value}/execute`,
      {
        sessions: toRun.map(s => ({
          points: s.points,
          agentId: s.agentId,
          parallelGroup: s.parallelGroup,
        })),
      },
    )
    appStore.toast('Очередь запущена', 'success')
    await loadOrchestratorState()
  } catch (e: unknown) {
    executing.value = false
    appStore.toast(String(e), 'error')
  }
}

async function advanceSession(sessionId: string) {
  if (!pid.value || !tid.value) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/sessions/${sessionId}/advance`, {})
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

// ——— Planning launch ———

async function launchPlanning() {
  if (!pid.value || !tid.value || !planningAgentId.value) return
  planningLaunching.value = true
  try {
    const result = await api.post<RunStartResult>(
      `/projects/${pid.value}/tasks/${tid.value}/runs`,
      { agent_id: planningAgentId.value, purpose: 'plan' },
    )
    const agent = agents.value.find(a => a.id === planningAgentId.value)
    const agentName = agent?.name ?? result.session_id
    const sameCount = sessions.value.filter(s => s.label.startsWith(agentName)).length + 1
    const label = `${agentName} #${sameCount} — ${task.value?.key ?? ''} [план]`
    sessions.value.push({ id: result.session_id, label, runId: result.run.id })
    activeSessionId.value = result.session_id

    if (result.mode === 'tmux') {
      await api.post('/terminal/sessions', {
        id: result.session_id,
        cmd: 'tmux',
        args: ['attach-session', '-t', result.session_id],
        cwd: appStore.currentProject?.repo_path ?? '/',
      }).catch(() => {})
    }

    planningActive.value = true
    planningRunId.value = result.run.id
    planningSessionId.value = result.session_id
    activeTab.value = 'plan'

    appStore.toast('Агент запущен для планирования', 'success')
    await loadRuns()
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    planningLaunching.value = false
  }
}

// Approve the plan: close the planning agent session and finalize the plan.
async function approvePlan() {
  if (planningRunId.value && pid.value && tid.value) {
    try {
      await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${planningRunId.value}/kill`, {})
    } catch { /* session may already be gone */ }
  }
  const sid = planningSessionId.value
  if (sid) {
    sessions.value = sessions.value.filter(s => s.id !== sid)
    if (activeSessionId.value === sid) {
      activeSessionId.value = sessions.value[sessions.value.length - 1]?.id ?? null
    }
  }
  planningActive.value = false
  planningRunId.value = null
  planningSessionId.value = null
  await loadPlan()
  await loadRuns()
  appStore.toast('План утверждён', 'success')
}

async function attachRun(runId: string) {
  if (!pid.value || !tid.value) return
  const run = runs.value.find(r => r.id === runId)
  if (!run) return
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
  if (planningSessionId.value === id) {
    planningActive.value = false
    planningRunId.value = null
    planningSessionId.value = null
  }
  await loadRuns()
  await loadPlan()
}

async function sendInput(text: string) {
  const s = activeSession.value
  if (!pid.value || !tid.value || !s) return
  await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${s.runId}/input`, { text })
}

// ——— Mark task done ———

async function markDoneTask() {
  if (!pid.value || !tid.value) return
  if (!confirm('Отметить задачу выполненной? Плановый файл будет удалён.')) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/done`, {})
    appStore.toast('Задача завершена', 'success')
    await loadTask()
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function deleteCurrentTask() {
  if (!pid.value || !tid.value) return
  if (!confirm(`Удалить задачу «${task.value?.key}»? Действие необратимо — план, запуски и сессии будут удалены.`)) return
  const id = tid.value
  try {
    await api.delete(`/projects/${pid.value}/tasks/${id}`)
    sessions.value = []
    activeSessionId.value = null
    sessionStore.clear(id)
    appStore.toast('Задача удалена', 'success')
    router.push('/')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

// ——— Plan editing ———

function startManualEdit() {
  planContent.value = plan.value?.content ?? ''
  editingPlan.value = true
}

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

async function markStepDone(stepIndex: number) {
  if (!plan.value || !pid.value || !tid.value) return
  plan.value = await api.post<Plan>(
    `/projects/${pid.value}/tasks/${tid.value}/plans/${plan.value.id}/step/${stepIndex}/done`,
    {},
  )
}

// ——— Helpers ———

function agentName(id: string): string {
  return agents.value.find(a => a.id === id)?.name ?? id
}

function statusLabel(s: string) {
  return { open: 'Открыта', in_progress: 'В работе', done: 'Завершена' }[s] ?? s
}

function runStatusLabel(s: string) {
  return { running: 'Выполняется', completed: 'Завершён', failed: 'Ошибка', interrupted: 'Прерван' }[s] ?? s
}

function sessionStatusLabel(s: string) {
  return {
    queued: 'В очереди',
    running: 'Выполняется',
    waiting_for_developer: 'Ожидает',
    complete: 'Готово',
    failed: 'Ошибка',
  }[s] ?? s
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
.task-title-block { flex: 1; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.task-key { font-size: 13px; color: var(--text-muted); }
.task-name { font-size: 15px; font-weight: 600; }
.task-status-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  border: 1px solid var(--border);
}
.task-status-badge.in_progress { color: #e3b341; border-color: #e3b341; }
.task-status-badge.done { color: var(--accent); border-color: var(--accent); }

/* Tab bar */
.task-tab-bar {
  display: flex;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.1s;
  margin-bottom: -1px;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--text); border-bottom-color: var(--blue); }

/* Tab bodies */
.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.exec-tab-body {
  overflow-y: auto;
  padding: 16px 20px;
  gap: 16px;
}

/* Plan tab — empty state hint */
.plan-empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

/* Plan tab — content */
.plan-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plan-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.plan-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.agent-select-sm { padding: 4px 8px; font-size: 12px; }

.planning-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #e3b341;
}
.planning-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #e3b341;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.plan-waiting {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  min-height: 120px;
}

.progress-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); flex: 1; }
.progress-bar { flex: 1; height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }

.steps { display: flex; flex-direction: column; gap: 4px; }
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
  border: 1px solid transparent;
}
.step:hover { background: var(--bg3); }
.step.done { color: var(--text-muted); text-decoration: line-through; cursor: default; }
.step.selected { border-color: var(--blue); background: rgba(88,166,255,0.08); }
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
.step-check.readonly { cursor: default; }
.step-check.readonly:not(.done):hover { background: none; }
.step-id { font-size: 10px; color: var(--text-muted); font-family: monospace; flex-shrink: 0; }
.step-text { flex: 1; }
.parallel-badge {
  font-size: 10px;
  color: var(--blue);
  background: rgba(88,166,255,0.12);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}

.plan-editor-wrap { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.plan-editor {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  padding: 10px;
  flex: 1;
  min-height: 200px;
  resize: none;
}
.plan-editor:focus { outline: none; border-color: var(--blue); }
.plan-actions { display: flex; gap: 8px; }

/* Exec tab */
.exec-section { display: flex; flex-direction: column; gap: 8px; }
.exec-no-plan { font-size: 13px; color: var(--text-muted); padding: 8px 0; }

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.queue-builder { }
.builder-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.agent-select {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}
.parallel-input {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  width: 160px;
}
.parallel-input:focus { outline: none; border-color: var(--blue); }
.selection-hint { font-size: 11px; color: var(--text-muted); }
.selection-hint.muted { opacity: 0.6; }

.queue-list { display: flex; flex-direction: column; gap: 4px; }
.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.queue-num { color: var(--text-muted); font-size: 11px; min-width: 20px; }
.queue-agent { font-weight: 600; }
.queue-points { color: var(--text-muted); font-family: monospace; font-size: 11px; flex: 1; }
.queue-status-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.queue-status-chip.running { color: #e3b341; border-color: #e3b341; }
.queue-status-chip.complete { color: var(--accent); border-color: var(--accent); }
.queue-status-chip.failed { color: var(--danger); border-color: var(--danger); }
.queue-status-chip.waiting_for_developer { color: #d29922; border-color: #d29922; }

.queue-actions { display: flex; gap: 8px; align-items: center; }

.runs-section { border-top: 1px solid var(--border); padding-top: 12px; }
.runs { display: flex; flex-direction: column; gap: 6px; }
.run-item {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.run-head { display: flex; align-items: center; gap: 8px; }
.run-agent { font-weight: 600; }
.run-date { color: var(--text-muted); margin-left: 4px; }
.run-status { margin-left: auto; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--border); font-size: 11px; }
.run-status.running { color: #e3b341; border-color: #e3b341; }
.run-status.completed { color: var(--accent); border-color: var(--accent); }
.run-status.failed { color: var(--danger); border-color: var(--danger); }
.run-notes { color: var(--text-muted); font-size: 11px; }

/* Terminal dock */
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
.waiting-badge {
  font-size: 11px;
  color: #d29922;
  border: 1px solid #d29922;
  padding: 1px 6px;
  border-radius: 8px;
}

.btn-xs { padding: 2px 6px; font-size: 11px; }
.danger { color: var(--danger); }
.empty-state.small { font-size: 13px; color: var(--text-muted); padding: 8px 0; }
</style>
