<template>
  <div class="task-view">
    <div class="task-header app-drag">
      <AppButton variant="subtle" size="sm" @click="goBack">← Назад</AppButton>
      <div class="task-title-block">
        <code class="task-key">{{ task?.key }}</code>
        <span class="task-name">{{ task?.title }}</span>
        <StatusBadge :status="task?.status" />
      </div>
      <div class="actions">
        <AppButton
          v-if="task?.status !== 'done'"
          variant="primary"
          size="sm"
          @click="markDoneTask"
        >✓ Завершить</AppButton>
        <AppButton variant="danger-ghost" size="sm" @click="deleteCurrentTask">
          <IconTrash /> Удалить
        </AppButton>
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
          <AppButton variant="primary" size="sm" @click="approvePlan">✓ Утвердить план</AppButton>
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
        <div v-if="planningTerminalSession" class="planning-terminal">
          <TerminalPane
            :session-id="planningTerminalSession.id"
            :label="planningTerminalSession.label"
            :visible="activeTab === 'plan'"
            :show-header="false"
            @detach="activeSessionId = null"
            @kill="killSession(planningTerminalSession.id)"
            @user-input="markRunActivity(planningTerminalSession.runId, 'thinking')"
            @input="sendInput"
          />
        </div>
      </div>

      <!-- Empty state — no plan yet -->
      <div v-else-if="!plan && !editingPlan" class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="progress-line"><span>Плана пока нет</span></div>
          <div class="plan-header-actions">
            <AppSelect v-model="planningAgentId" :options="agentOptions" placeholder="Агент" size="sm" />
            <AppSelect v-if="planningModelChoices.length" v-model="planningModel" :options="planningModelChoices" placeholder="Модель" size="sm" />
            <AppSelect v-if="planningReasoningChoices.length" v-model="planningReasoning" :options="planningReasoningChoices" placeholder="Рассуждения" size="sm" />
            <AppButton
              variant="primary"
              size="sm"
              :disabled="!planningAgentId || planningLaunching"
              @click="launchPlanning"
            >{{ planningLaunching ? 'Запуск...' : '▸ Составить план с агентом' }}</AppButton>
            <AppButton variant="ghost" size="sm" @click="startManualEdit">Написать вручную</AppButton>
          </div>
        </div>
        <p class="plan-empty-hint">опишите задачу агенту в терминале — работают <code>@файлы</code>, перетаскивание и вставка файлов</p>
      </div>

      <!-- Plan editor (manual) -->
      <div v-else-if="editingPlan" class="plan-tab-content">
        <div class="plan-editor-wrap">
          <textarea v-model="planContent" class="plan-editor" placeholder="---&#10;plangent: 1&#10;key: KEY&#10;title: Title&#10;status: open&#10;---&#10;&#10;- [ ] (p1) Step 1&#10;- [ ] (p2) Step 2" />
          <div class="plan-editor-helper">
            <span><code>[ ]</code> в начале строки = шаг очереди. Удалишь скобки - шаг пропадёт.</span>
            <div v-if="checkboxLinePreviews.length" class="checkbox-preview">
              <span v-for="line in checkboxLinePreviews" :key="line" class="checkbox-line"><code>{{ line.marker }}</code>{{ line.text }}</span>
            </div>
          </div>
          <div class="plan-actions">
            <AppButton variant="primary" size="sm" @click="savePlan">Сохранить</AppButton>
            <AppButton variant="ghost" size="sm" @click="editingPlan = false">Отмена</AppButton>
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
            <AppSelect v-model="planningAgentId" :options="agentOptions" placeholder="Агент" size="sm" />
            <AppSelect v-if="planningModelChoices.length" v-model="planningModel" :options="planningModelChoices" placeholder="Модель" size="sm" />
            <AppSelect v-if="planningReasoningChoices.length" v-model="planningReasoning" :options="planningReasoningChoices" placeholder="Рассуждения" size="sm" />
            <AppButton
              variant="ghost"
              size="sm"
              :disabled="!planningAgentId || planningLaunching"
              @click="launchPlanning"
            >{{ planningLaunching ? 'Запуск...' : '▸ Изменить план с агентом' }}</AppButton>
            <AppButton variant="ghost" size="sm" @click="togglePlanEdit">Редактировать вручную</AppButton>
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
            <span v-if="s.parallelGroup" class="parallel-badge">параллельно: {{ s.parallelGroup }}</span>
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
            :class="{ done: s.done, selected: isStepSelected(s), assigned: isStepAssigned(s) }"
            @click="toggleStepSelection(s)"
          >
            <button class="step-check" :class="{ done: s.done }" @click.stop="toggleStepSelection(s)">
              {{ s.done ? '✓' : '' }}
            </button>
            <span class="step-id" v-if="s.id">{{ s.id }}</span>
            <span class="step-text">{{ s.text }}</span>
            <span v-if="s.parallelGroup" class="parallel-badge">параллельно: {{ s.parallelGroup }}</span>
            <span v-if="isStepAssigned(s)" class="assigned-badge">в сессии</span>
          </div>
        </div>

        <div v-if="task?.status !== 'done'" class="selection-actions" :class="{ active: selectedSteps.length > 0 }">
          <template v-if="selectedSteps.length">
            <div class="selection-summary">
              Выбрано: {{ selectedSteps.length }}
              <span v-if="selectedAddableStepIds.length < selectedSteps.length" class="muted">
                · {{ selectedSteps.length - selectedAddableStepIds.length }} уже в сессии или выполнено
              </span>
            </div>
            <AppSelect v-model="builderAgentId" :options="agentOptions" placeholder="Агент" size="sm" />
            <AppSelect v-if="builderModelChoices.length" v-model="builderModel" :options="builderModelChoices" placeholder="Модель" size="sm" />
            <AppSelect v-if="builderReasoningChoices.length" v-model="builderReasoning" :options="builderReasoningChoices" placeholder="Рассуждения" size="sm" />
            <label class="inline-toggle" title="Соседние сессии с этой отметкой стартуют одновременно">
              <input type="checkbox" v-model="builderRunTogether" />
              <span>Запустить одновременно</span>
            </label>
            <AppButton
              variant="primary"
              size="sm"
              :disabled="!builderAgentId || selectedAddableStepIds.length === 0"
              @click="addQueueSession('execute')"
            >Добавить: выполнить</AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              :disabled="!builderAgentId || selectedAddableStepIds.length === 0"
              @click="addQueueSession('review_first')"
            >Добавить: обсудить</AppButton>
            <AppButton
              v-if="selectedIncompleteSteps.length"
              variant="ghost"
              size="sm"
              @click="setSelectedStepsDone(true)"
            >Отметить выполненным</AppButton>
            <AppButton
              v-if="selectedDoneSteps.length"
              variant="ghost"
              size="sm"
              @click="setSelectedStepsDone(false)"
            >Вернуть в работу</AppButton>
            <AppButton variant="subtle" size="sm" @click="clearSelection">Снять выбор</AppButton>
          </template>
          <span v-else class="selection-hint muted">
            Кликните по строке или чекбоксу, чтобы выбрать шаг и открыть действия.
          </span>
        </div>
      </div>
      <div v-else class="exec-no-plan">
        Нет плана. Создайте план на вкладке «План».
      </div>

      <!-- Queue list -->
      <div v-if="queueSessions.length > 0" class="exec-section">
        <div class="queue-list">
          <div
            v-for="row in executionSessionRows"
            :key="row.key"
            class="queue-item"
            :class="[row.queueSession?.status, { expanded: row.terminalSession && activeSessionId === row.terminalSession.id }]"
          >
            <div class="queue-row-main">
	              <span class="queue-num">#{{ row.index }}</span>
	              <span class="queue-agent">{{ row.agentName }}</span>
	              <span class="queue-points">{{ row.pointsLabel }}</span>
	              <span class="mode-badge" :class="row.queueSession?.queueMode">{{ row.modeLabel }}</span>
	              <span v-if="row.queueSession?.parallelGroup" class="parallel-badge">одновременно</span>
              <span class="queue-status-chip" :class="row.statusClass">{{ row.statusLabel }}</span>
              <AppButton
                v-if="row.canAttach && (!row.terminalSession || activeSessionId !== row.terminalSession.id)"
                variant="ghost"
                size="sm"
                @click="attachRun(row.runId!)"
              >Подключиться</AppButton>
              <AppButton
                v-if="row.terminalSession && activeSessionId === row.terminalSession.id"
                class="terminal-toggle-btn"
                variant="ghost"
                size="sm"
                @click="activeSessionId = null"
              >Свернуть</AppButton>
		              <button
		                v-if="row.queueSession?.queueMode === 'review_first' && row.queueSession?.status !== 'queued' && row.queueSession?.status !== 'running' && row.queueSession?.status !== 'complete' && row.queueSession?.status !== 'failed'"
		                class="btn btn-primary btn-sm"
		                :disabled="!row.canExecuteReview"
		                :title="row.executeTitle"
		                @click="executeReadySession(row.queueSession.id)"
		              >Выполнить</button>
              <AppButton
                v-if="row.terminalSession"
                variant="danger-ghost"
                size="sm"
                @click="killSession(row.terminalSession.id)"
              >Завершить</AppButton>
            <button
              v-if="row.queueSession?.status === 'queued'"
              class="pause-pill"
              :class="{ active: row.queueSession.pauseAfter }"
              @click="row.queueSession.pauseAfter = !row.queueSession.pauseAfter"
              :title="row.queueSession.pauseAfter ? 'Очередь остановится после этой сессии — нажмите, чтобы убрать паузу' : 'Остановить очередь после этой сессии для ревью'"
            >⏸ пауза после</button>
            <span v-else-if="row.queueSession?.pauseAfter" class="pause-badge" title="Очередь остановится после этой сессии">⏸ ревью</span>
            <AppButton
              v-if="row.queueSession?.status === 'queued'"
              variant="danger-ghost"
              size="xs"
              @click="removeQueueSession(row.queueIndex!)"
            >✕</AppButton>
            </div>
            <div v-if="row.terminalSession && activeSessionId === row.terminalSession.id" class="terminal-inline">
              <TerminalPane
                :session-id="row.terminalSession.id"
                :label="row.terminalSession.label"
                :visible="activeSessionId === row.terminalSession.id"
                :show-header="false"
                @detach="activeSessionId = null"
                @kill="killSession(row.terminalSession.id)"
                @user-input="markRunActivity(row.terminalSession.runId, 'thinking')"
                @input="sendInput"
              />
            </div>
          </div>
        </div>

        <!-- Pause checkpoint banner -->
	        <div v-if="queuePaused" class="queue-paused-banner">
	        <span>{{ readyForExecutionSessions.length ? 'Очередь на паузе — обсудите шаги или запустите выполнение.' : '⏸ Очередь на паузе — ревью перед следующим шагом.' }}</span>
	          <AppButton v-if="!readyForExecutionSessions.length" variant="primary" size="sm" @click="resumeQueue">▶ Продолжить очередь</AppButton>
	        </div>

        <div class="queue-actions" v-if="!executing && queueSessions.some(s => s.status === 'queued') && task?.status !== 'done'">
          <AppButton
            variant="primary"
            :disabled="executing || queueSessions.filter(s => s.status === 'queued').length === 0"
            @click="runQueue"
          >
            {{ executing ? 'Выполняется...' : '▶ Запустить очередь' }}
          </AppButton>
          <AppButton variant="ghost" @click="clearQueuedSessions">Очистить</AppButton>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useTaskSessionStore } from '../stores/taskSession'
import { api } from '@core/api'
import type {
	  Task, Plan, Run, RunStartResult,
	  PlanStep, OrchestratorQueueSession, OrchestratorResponse,
	  OrchestratorEvent, ExecuteResponse, QueueSessionMode,
	} from '@core/models'
import TerminalPane from '../components/TerminalPane.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { hasPlaceholder } from '@shared/agent-placeholders'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const sessionStore = useTaskSessionStore()

const task = ref<Task | null>(appStore.currentTask)
const plan = ref<Plan | null>(null)
const runs = ref<Run[]>([])
const agents = computed(() => agentsStore.agents)
const agentOptions = computed(() => agents.value.map(a => ({ value: a.id, label: a.name })))
const executing = ref(false)
const editingPlan = ref(false)
const planContent = ref('')

const activeTab = ref<'plan' | 'exec'>('plan')

// Planning launch state
const planningAgentId = ref(appStore.currentProject?.default_agent_id ?? '')
const planningModelOverride = ref<string | null>(null)
const planningReasoningOverride = ref<string | null>(null)
const planningLaunching = ref(false)
const planningActive = ref(false)
const planningRunId = ref<string | null>(null)
const planningSessionId = ref<string | null>(null)

// Queue builder state
const builderAgentId = ref(appStore.currentProject?.default_agent_id ?? '')
const builderModelOverride = ref<string | null>(null)
const builderReasoningOverride = ref<string | null>(null)
const builderRunTogether = ref(false)

// Per-run model/reasoning-effort override — only exposed once the selected agent's
// own args template has a {model}/{reasoning} placeholder AND the developer has
// defined at least one choice for it in Settings (Agent.model_options/reasoning_options).
// Left untouched, the picker shows (and a launch sends) the agent's own configured
// default (Agent.model/reasoning_effort); picking a value overrides it for this run only.
const planningAgent = computed(() => agents.value.find(a => a.id === planningAgentId.value) ?? null)
const planningModelChoices = computed(() =>
  (hasPlaceholder(planningAgent.value?.args, '{model}') ? planningAgent.value!.model_options : [])
    .map(v => ({ value: v, label: v })),
)
const planningReasoningChoices = computed(() =>
  (hasPlaceholder(planningAgent.value?.args, '{reasoning}') ? planningAgent.value!.reasoning_options : [])
    .map(v => ({ value: v, label: v })),
)
const planningModel = computed({
  get: () => planningModelOverride.value ?? planningAgent.value?.model ?? '',
  set: v => { planningModelOverride.value = v },
})
const planningReasoning = computed({
  get: () => planningReasoningOverride.value ?? planningAgent.value?.reasoning_effort ?? '',
  set: v => { planningReasoningOverride.value = v },
})

const builderAgent = computed(() => agents.value.find(a => a.id === builderAgentId.value) ?? null)
const builderModelChoices = computed(() =>
  (hasPlaceholder(builderAgent.value?.args, '{model}') ? builderAgent.value!.model_options : [])
    .map(v => ({ value: v, label: v })),
)
const builderReasoningChoices = computed(() =>
  (hasPlaceholder(builderAgent.value?.args, '{reasoning}') ? builderAgent.value!.reasoning_options : [])
    .map(v => ({ value: v, label: v })),
)
const builderModel = computed({
  get: () => builderModelOverride.value ?? builderAgent.value?.model ?? '',
  set: v => { builderModelOverride.value = v },
})
const builderReasoning = computed({
  get: () => builderReasoningOverride.value ?? builderAgent.value?.reasoning_effort ?? '',
  set: v => { builderReasoningOverride.value = v },
})

watch(planningAgentId, () => { planningModelOverride.value = null; planningReasoningOverride.value = null })
watch(builderAgentId, () => { builderModelOverride.value = null; builderReasoningOverride.value = null })
const selectedStepIds = ref<Set<string>>(new Set())
const queueSessions = ref<OrchestratorQueueSession[]>([])
const queuePaused = ref(false)

interface TaskSession { id: string; label: string; runId: string }
const sessions = ref<TaskSession[]>([])
const activeSessionId = ref<string | null>(null)
const activeSession = computed(() => sessions.value.find(s => s.id === activeSessionId.value) ?? null)
const planningTerminalSession = computed(() =>
  planningSessionId.value ? sessions.value.find(s => s.id === planningSessionId.value) ?? null : null,
)
const waitingSessionIds = ref<Set<string>>(new Set())
type SessionActivity = 'thinking' | 'idle' | 'waiting' | 'missing'
const sessionActivityByRunId = ref<Record<string, SessionActivity>>({})
const sessionOutputState = new Map<string, { signature: string; changedAt: number; seenOutput: boolean }>()
let activityPollTimer: number | null = null

const doneCount = computed(() => plan.value?.steps.filter(s => s.done).length ?? 0)
const checkboxLinePreviews = computed(() =>
  planContent.value
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*-\s*\[[ x]\])\s*(.*)$/i)
      return match ? { marker: match[1].trim(), text: ` ${match[2]}` } : null
    })
    .filter((line): line is { marker: string; text: string } => !!line)
    .slice(0, 6),
)
const progressPct = computed(() => {
  if (!plan.value?.steps.length) return 0
  return Math.round((doneCount.value / plan.value.steps.length) * 100)
})
const assignedStepIds = computed(() => {
  const ids = new Set<string>()
  for (const session of queueSessions.value) {
    if (session.status === 'complete' || session.status === 'failed') continue
    for (const point of session.points) ids.add(point)
  }
  return ids
})
const selectedSteps = computed(() => plan.value?.steps.filter(s => s.id && selectedStepIds.value.has(s.id)) ?? [])
const selectedDoneSteps = computed(() => selectedSteps.value.filter(s => s.done))
const selectedIncompleteSteps = computed(() => selectedSteps.value.filter(s => !s.done))
const selectedAddableStepIds = computed(() =>
  selectedIncompleteSteps.value
    .map(s => s.id)
    .filter((id): id is string => !!id && !assignedStepIds.value.has(id)),
	)
const readyForExecutionSessions = computed(() =>
  queueSessions.value.filter(s => s.status === 'ready_for_execution'),
)
const executionSessionRows = computed(() => {
	  const rows = queueSessions.value.map((queueSession, queueIndex) => {
	    const run = queueSession.runId ? runs.value.find(r => r.id === queueSession.runId) ?? null : null
	    const terminalSession = queueSession.runId
	      ? sessions.value.find(s => s.runId === queueSession.runId) ?? null
	      : null
	    const activity = queueSession.runId ? sessionActivityByRunId.value[queueSession.runId] : undefined
	    const canExecuteReview = queueSession.queueMode === 'review_first' &&
	      !!terminalSession &&
	      activity !== 'thinking' &&
	      queueSession.status !== 'queued' &&
	      queueSession.status !== 'running' &&
	      queueSession.status !== 'complete' &&
	      queueSession.status !== 'failed'
	    return {
      key: queueSession.id,
      index: queueIndex + 1,
      queueIndex,
      queueSession,
      run,
      terminalSession,
	      agentName: agentName(queueSession.agentId),
	      pointsLabel: queueSession.points.join(', '),
	      modeLabel: queueModeLabel(queueSession.queueMode),
	      statusClass: sessionStatusClass(queueSession),
	      statusLabel: sessionStatusLabel(queueSession),
	      runId: queueSession.runId ?? run?.id ?? null,
	      canAttach: !!queueSession.runId && !!terminalSession,
	      canExecuteReview,
	      executeTitle: canExecuteReview
	        ? 'Запустить выполнение с текущим контекстом обсуждения'
	        : activity === 'thinking'
	          ? 'Агент ещё думает'
	          : 'Нет активного терминала для продолжения',
	    }
  })

  return rows
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
	      if (queueSess) {
	        queueSess.status = queueSess.queueMode === 'review_first' ? 'reviewing' : 'running'
	        queueSess.runId = event.runId
	        queueSess.sessionId = event.terminalSessionId
	        queueSess.mode = event.mode
	      }
	      markRunActivity(event.runId, 'thinking')
	      addTerminalSession(event.terminalSessionId, event.runId)
      loadRuns()
	      break
	    }
	    case 'session_ready_for_execution': {
	      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
	      if (queueSess) {
	        queueSess.status = 'ready_for_execution'
		        if (event.runId) queueSess.runId = event.runId
		        if (event.terminalSessionId) queueSess.sessionId = event.terminalSessionId
		      }
	      if (event.runId) markRunActivity(event.runId, 'idle')
		      if (event.terminalSessionId) waitingSessionIds.value.add(event.terminalSessionId)
	      queuePaused.value = true
	      executing.value = true
	      appStore.toast(event.message, 'warning')
	      break
	    }
    case 'session_complete': {
      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
      if (queueSess) {
        queueSess.status = 'complete'
	        if (event.runId) queueSess.runId = event.runId
	      }
	      if (event.runId) markRunActivity(event.runId, 'idle')
	      if (event.runId) waitingSessionIds.value.delete(event.runId)
	      loadRuns()
	      break
	    }
	    case 'session_idle': {
	      markRunActivity(event.runId, 'idle')
	      break
	    }
	    case 'session_waiting': {
	      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
	      if (queueSess) queueSess.status = 'waiting_for_developer'
	      if (event.runId) markRunActivity(event.runId, 'waiting')
	      if (event.terminalSessionId) {
        waitingSessionIds.value.add(event.terminalSessionId)
      }
      appStore.toast(event.message, 'warning')
      break
    }
	    case 'session_failed': {
	      const queueSess = queueSessions.value.find(s => s.id === event.sessionId)
	      if (queueSess) queueSess.status = 'failed'
	      if (queueSess?.runId) markRunActivity(queueSess.runId, 'missing')
	      appStore.toast(`Сессия остановлена: ${event.reason}`, 'warning')
      break
    }
    case 'queue_paused': {
      queuePaused.value = true
      // Keep `executing` true: the orchestrator is still active (just waiting),
      // so the "Запустить очередь" button stays disabled and only the
      // "Продолжить очередь" action is offered.
      executing.value = true
      appStore.toast('Очередь на паузе — проведите ревью и нажмите «Продолжить очередь».', 'warning')
      break
    }
    case 'queue_resumed': {
      queuePaused.value = false
      executing.value = true
      break
    }
    case 'queue_finished': {
      executing.value = false
      queuePaused.value = false
      appStore.toast('Очередь выполнена, можете проверить изменения', 'success')
      loadRuns()
      loadPlan()
      break
    }
	    case 'run_failed': {
	      executing.value = false
	      appStore.toast(`Ошибка выполнения: ${event.reason}`, 'error')
	      break
	    }
	    case 'session_no_signal': {
	      markRunActivity(event.runId, 'waiting')
	      appStore.toast(event.message, 'warning')
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
    return
  }
  const label = `Session — ${task.value?.key ?? ''}`
  sessions.value.push({ id: terminalSessionId, label, runId })
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

async function getRunSessionStatus(runId: string): Promise<{ running: boolean; session_id?: string; mode?: 'tmux' | 'pty'; output?: string }> {
  if (!pid.value || !tid.value) return { running: false }
  return api.get<{ running: boolean; session_id?: string; mode?: 'tmux' | 'pty'; output?: string }>(
    `/projects/${pid.value}/tasks/${tid.value}/runs/${runId}/session`,
  )
}

async function pruneDeadTerminalSessions() {
  const liveSessions: TaskSession[] = []
  for (const session of sessions.value) {
    try {
      const status = await getRunSessionStatus(session.runId)
      if (status.running && status.session_id) {
        liveSessions.push({ ...session, id: status.session_id })
	      } else {
	        const queueSession = queueSessions.value.find(q => q.runId === session.runId)
	        if (queueSession && queueSession.status !== 'complete' && queueSession.status !== 'failed') {
	          queueSession.status = 'failed'
	        }
	        markRunActivity(session.runId, 'missing')
	        waitingSessionIds.value.delete(session.id)
	        if (activeSessionId.value === session.id) activeSessionId.value = null
	      }
    } catch {
      liveSessions.push(session)
    }
  }
  sessions.value = liveSessions
}

function activeQueueSessionsForActivity() {
  return queueSessions.value.filter(s =>
    !!s.runId &&
    s.status !== 'queued' &&
    s.status !== 'complete' &&
    s.status !== 'failed',
  )
}

async function pollSessionActivity() {
  const now = Date.now()
  for (const queueSession of activeQueueSessionsForActivity()) {
    if (!queueSession.runId) continue
    try {
      const status = await getRunSessionStatus(queueSession.runId)
      if (!status.running) {
        markRunActivity(queueSession.runId, 'missing')
        continue
      }

      const output = status.output ?? ''
      const signature = output.slice(-4000)
      const prev = sessionOutputState.get(queueSession.runId)
      if (!prev) {
        sessionOutputState.set(queueSession.runId, {
          signature,
          changedAt: now,
          seenOutput: output.trim().length > 0,
        })
        continue
      }

      if (signature !== prev.signature) {
        sessionOutputState.set(queueSession.runId, {
          signature,
          changedAt: now,
          seenOutput: prev.seenOutput || output.trim().length > 0,
        })
        continue
      }

      const stableMs = now - prev.changedAt
      if (prev.seenOutput && stableMs > 3000) {
        if (queueSession.status === 'reviewing' && queueSession.queueMode === 'review_first') {
          await markSessionReady(queueSession.id, true)
        } else if (sessionActivityByRunId.value[queueSession.runId] === 'thinking') {
          markRunActivity(queueSession.runId, 'idle')
        }
      }
    } catch {
      // Keep the last known status; transient polling failures should not flip UI state.
    }
  }
}

async function loadOrchestratorState() {
  if (!pid.value || !tid.value) return
  try {
    const resp = await api.get<OrchestratorResponse>(`/projects/${pid.value}/tasks/${tid.value}/orchestrator`)
    if (!resp.active || !resp.state) {
      await pruneDeadTerminalSessions()
      return
    }

    mergeQueueSessions(resp.state.sessions)
	    executing.value = resp.state.status === 'running' || resp.state.status === 'paused'
    queuePaused.value = resp.state.status === 'paused'
    // Re-attach only sessions that are still live server-side. Completed queue
    // records may outlive their PTY/tmux process after the user presses
    // "Завершить", and those must not show Connect/Finish controls again.
    for (const s of resp.state.sessions) {
      if (s.status !== 'failed' && s.runId) {
        const status = await getRunSessionStatus(s.runId)
        if (status.running && status.session_id) {
          if (!sessions.value.some(ts => ts.runId === s.runId)) {
            sessions.value.push({
              id: status.session_id,
              label: `Session — ${task.value?.key ?? ''}`,
              runId: s.runId,
            })
          }
          if (s.status === 'waiting_for_developer') {
            waitingSessionIds.value.add(status.session_id)
          }
        }
      }
    }
    await pruneDeadTerminalSessions()
  } catch {}
}

onMounted(async () => {
  await loadTask()
  restoreSessions()
  await Promise.all([loadPlan(), loadRuns(), agentsStore.load(), loadOrchestratorState()])
  await pruneDeadTerminalSessions()
	  if (!planningAgentId.value && agents.value.length) planningAgentId.value = agents.value[0].id
	  if (!builderAgentId.value && agents.value.length) builderAgentId.value = agents.value[0].id
	  connectEvents()
	  activityPollTimer = window.setInterval(() => { pollSessionActivity() }, 2500)
	})
	
	onUnmounted(() => {
	  if (eventsWs) { eventsWs.onclose = null; eventsWs.close() }
	  if (activityPollTimer !== null) window.clearInterval(activityPollTimer)
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
	  queueSessions.value = (snap.queueSessions ?? []).map(s => ({ ...s, queueMode: s.queueMode ?? 'execute' }))
	  activeSessionId.value = null
	  waitingSessionIds.value = new Set(snap.waitingSessionIds)
	  sessionActivityByRunId.value = { ...(snap.sessionActivityByRunId ?? {}) } as Record<string, SessionActivity>
	  planningActive.value = snap.planningActive
  planningRunId.value = snap.planningRunId
  planningSessionId.value = snap.planningSessionId
}

function saveSessions() {
  if (!tid.value) return
  sessionStore.save(tid.value, {
    sessions: sessions.value.map(s => ({ ...s })),
    activeSessionId: null,
	    queueSessions: queueSessions.value.map(s => ({ ...s })),
	    waitingSessionIds: [...waitingSessionIds.value],
	    sessionActivityByRunId: { ...sessionActivityByRunId.value },
	    planningActive: planningActive.value,
    planningRunId: planningRunId.value,
    planningSessionId: planningSessionId.value,
  })
}

watch(
	  [sessions, queueSessions, waitingSessionIds, sessionActivityByRunId, planningActive, planningRunId, planningSessionId],
  () => saveSessions(),
  { deep: true },
)

function goBack() {
  // Keep the agent and its terminal alive; onUnmounted saves the snapshot so the
  // session is restored when the developer comes back.
  router.push('/')
}

// ——— Step selection (for execution queue) ———

function isStepSelected(s: PlanStep): boolean {
  return s.id ? selectedStepIds.value.has(s.id) : false
}

function isStepAssigned(s: PlanStep): boolean {
  return !!s.id && assignedStepIds.value.has(s.id)
}

function toggleStepSelection(s: PlanStep) {
  if (!s.id) return
  if (selectedStepIds.value.has(s.id)) {
    selectedStepIds.value.delete(s.id)
  } else {
    selectedStepIds.value.add(s.id)
  }
  selectedStepIds.value = new Set(selectedStepIds.value)
}

function clearSelection() {
  selectedStepIds.value = new Set()
}

function mergeQueueSessions(incoming: OrchestratorQueueSession[]) {
  const byId = new Map(queueSessions.value.map(s => [s.id, s]))
  const merged = [...queueSessions.value]
	  for (const session of incoming) {
	    const normalized = { ...session, queueMode: session.queueMode ?? 'execute' as QueueSessionMode }
	    const existing = byId.get(normalized.id)
	    if (existing) {
	      Object.assign(existing, normalized)
	    } else {
	      merged.push(normalized)
	    }
	  }
  queueSessions.value = merged
}

function replaceQueuedSessions(localSessions: OrchestratorQueueSession[], serverSessions: OrchestratorQueueSession[]) {
  const localIds = new Set(localSessions.map(s => s.id))
  queueSessions.value = queueSessions.value.filter(s => !localIds.has(s.id))
  mergeQueueSessions(serverSessions)
}

// ——— Queue builder ———

function addQueueSession(queueMode: QueueSessionMode) {
	  if (!builderAgentId.value || selectedAddableStepIds.value.length === 0) return
	  queueSessions.value.push({
    id: crypto.randomUUID(),
    points: [...selectedAddableStepIds.value],
	    agentId: builderAgentId.value,
	    parallelGroup: builderRunTogether.value ? 'together' : null,
	    queueMode,
	    pauseAfter: false,
	    model: builderModel.value || undefined,
	    reasoningEffort: builderReasoning.value || undefined,
    status: 'queued',
  })
  clearSelection()
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
    const resp = await api.post<ExecuteResponse>(
      `/projects/${pid.value}/tasks/${tid.value}/execute`,
      {
        sessions: toRun.map(s => ({
          points: s.points,
          agentId: s.agentId,
	          parallelGroup: s.parallelGroup,
	          queueMode: s.queueMode ?? 'execute',
	          pauseAfter: s.pauseAfter ?? false,
	          model: s.model,
	          reasoningEffort: s.reasoningEffort,
        })),
      },
    )
    replaceQueuedSessions(toRun, resp.sessions)
    appStore.toast('Очередь запущена', 'success')
    await loadOrchestratorState()
	  } catch (e: unknown) {
	    executing.value = false
	    appStore.toast(String(e), 'error')
	  }
}

async function executeReadySession(sessionId: string) {
  if (!pid.value || !tid.value) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/sessions/${sessionId}/execute`, {})
    const queueSess = queueSessions.value.find(s => s.id === sessionId)
    if (queueSess) {
      queueSess.status = 'running'
      if (queueSess.runId) markRunActivity(queueSess.runId, 'thinking')
      if (queueSess.sessionId) waitingSessionIds.value.delete(queueSess.sessionId)
    }
    queuePaused.value = false
    executing.value = true
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

async function markSessionReady(sessionId: string, silent = false) {
  if (!pid.value || !tid.value) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/sessions/${sessionId}/ready`, {})
  } catch (e: unknown) {
    if (!silent) appStore.toast(String(e), 'error')
  }
}

async function resumeQueue() {
  if (!pid.value || !tid.value) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/orchestrator/resume`, {})
    queuePaused.value = false
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
      {
        agent_id: planningAgentId.value,
        purpose: 'plan',
        model: planningModel.value || undefined,
        reasoning_effort: planningReasoning.value || undefined,
      },
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
    if (activeSessionId.value === sid) activeSessionId.value = null
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
  const status = await getRunSessionStatus(runId)
  if (!status.running || !status.session_id) {
    if (existing) sessions.value = sessions.value.filter(s => s.runId !== runId)
    appStore.toast('Терминал этой сессии уже недоступен', 'warning')
    await loadRuns()
    return
  }
  if (existing) {
    activeSessionId.value = existing.id
    return
  }
  const sessionId = status.session_id
  const label = `${run.agent_name} — ${task.value?.key ?? ''}`
  sessions.value.push({ id: sessionId, label, runId })
  activeSessionId.value = sessionId
}

async function killSession(id: string) {
  const s = sessions.value.find(sess => sess.id === id)
	  if (!s || !pid.value || !tid.value) return
	  if (!(await appStore.confirm('Завершить сессию агента?', { confirmLabel: 'Завершить' }))) return
	  try {
	    const queueSession = queueSessions.value.find(q => q.runId === s.runId)
	    if (queueSession) {
	      await api.post(`/projects/${pid.value}/tasks/${tid.value}/sessions/${queueSession.id}/cancel`, {})
	      queueSession.status = 'failed'
	    } else {
	      await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${s.runId}/kill`, {})
	    }
	    appStore.toast('Агент остановлен')
	  } catch (e: unknown) { appStore.toast(String(e), 'error') }
  sessions.value = sessions.value.filter(sess => sess.id !== id)
  if (activeSessionId.value === id) activeSessionId.value = null
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
  markRunActivity(s.runId, 'thinking')
  await api.post(`/projects/${pid.value}/tasks/${tid.value}/runs/${s.runId}/input`, { text })
}

// ——— Mark task done ———

async function markDoneTask() {
  if (!pid.value || !tid.value) return
  if (!(await appStore.confirm('Отметить задачу выполненной? Плановый файл будет удалён.', { confirmLabel: 'Отметить выполненной', danger: false }))) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/done`, {})
    appStore.toast('Задача завершена', 'success')
    await loadTask()
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function deleteCurrentTask() {
  if (!pid.value || !tid.value) return
  if (!(await appStore.confirm(`Удалить задачу «${task.value?.key}»? Действие необратимо — план, запуски и сессии будут удалены.`))) return
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

async function setPlanStepDone(stepIndex: number, done: boolean) {
  if (!plan.value || !pid.value || !tid.value) return
  plan.value = await api.patch<Plan>(
    `/projects/${pid.value}/tasks/${tid.value}/plans/${plan.value.id}/step/${stepIndex}`,
    { done },
  )
}

async function setSelectedStepsDone(done: boolean) {
  const steps = done ? selectedIncompleteSteps.value : selectedDoneSteps.value
  if (!steps.length) return
  try {
    for (const step of steps) {
      await setPlanStepDone(step.index, done)
    }
    clearSelection()
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}

// ——— Helpers ———

function agentName(id: string): string {
  return agents.value.find(a => a.id === id)?.name ?? id
}

function statusLabel(s: string) {
  return { open: 'Открыта', in_progress: 'В работе', done: 'Завершена' }[s] ?? s
}

function sessionStatusLabel(session: OrchestratorQueueSession) {
  const activity = session.runId ? sessionActivityByRunId.value[session.runId] : undefined
  if (session.queueMode === 'review_first') {
    if (session.status === 'queued') return 'В очереди'
    if (session.status === 'running') return 'Выполняется'
    if (session.status === 'complete') return 'Готово'
    if (session.status === 'failed') return 'Ошибка'
    if (activity === 'thinking') return 'Думает'
    if (activity === 'missing') return 'Нет терминала'
    return 'Готов к выполнению'
  }
  if (session.status === 'running' && activity === 'thinking') return 'Выполняется'
  if (session.status === 'waiting_for_developer') return 'Ожидает ввода'
  return {
    queued: 'В очереди',
    running: 'Выполняется',
    complete: 'Готово',
    failed: 'Ошибка',
  }[session.status] ?? session.status
}

function sessionStatusClass(session: OrchestratorQueueSession) {
  const activity = session.runId ? sessionActivityByRunId.value[session.runId] : undefined
  if (session.queueMode === 'review_first') {
    if (activity === 'thinking') return 'thinking'
    if (activity === 'missing') return 'failed'
    if (session.status === 'reviewing' || session.status === 'ready_for_execution' || session.status === 'waiting_for_developer') {
      return 'ready_for_execution'
    }
  }
  return session.status
}

function queueModeLabel(mode?: QueueSessionMode) {
  return mode === 'review_first' ? 'Обсудить' : 'Выполнить'
}

function markRunActivity(runId: string | undefined, activity: SessionActivity) {
  if (!runId) return
  if (activity === 'thinking') {
    sessionOutputState.delete(runId)
  }
  sessionActivityByRunId.value = { ...sessionActivityByRunId.value, [runId]: activity }
}

</script>

<style scoped>
.task-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.task-header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: calc(var(--titlebar-h) + var(--sp-2)) var(--sp-5) var(--sp-3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.task-title-block { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.task-key { font-size: 13px; color: var(--text-muted); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.task-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }

/* Tab bar */
.task-tab-bar {
  display: flex;
  gap: 2px;
  padding: 0 var(--sp-5);
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

.steps { display: flex; flex-direction: column; gap: 3px; }
.step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  border: 1px solid transparent;
}
.step:hover { background: var(--bg3); }
.step.done { color: var(--text-muted); }
.step.done .step-text { text-decoration: line-through; text-decoration-color: var(--text-faint); }
.step.selected { border-color: var(--blue); background: var(--blue-soft); }
.step.assigned:not(.selected) { background: rgba(88,166,255,0.05); }
.step-check {
  width: 18px; height: 18px;
  border: 1.5px solid var(--border-strong);
  border-radius: 5px;
  background: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  color: white;
  transition: background 0.12s, border-color 0.12s;
}
.step-check:not(.done):hover { border-color: var(--accent); background: var(--accent-soft); }
.step-check.done { background: var(--accent); border-color: var(--accent); }
.step-check.readonly { cursor: default; }
.step-check.readonly:not(.done):hover { background: none; border-color: var(--border-strong); }
.step-id { font-size: 10px; color: var(--text-muted); font-family: monospace; flex-shrink: 0; }
.step-text { flex: 1; }
.assigned-badge {
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}
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
.plan-editor-helper {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.plan-editor-helper > span code,
.plan-editor-helper code {
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--text);
}
.checkbox-preview {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.checkbox-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px 4px 6px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkbox-line code {
  flex-shrink: 0;
  border-color: var(--blue);
  color: var(--blue-hover);
  background: var(--blue-soft);
  font-weight: 600;
}
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

.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 34px;
  padding-top: 4px;
}
.selection-actions.active {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 8px;
}
.selection-summary {
  font-size: 12px;
  color: var(--text);
}
.selection-summary .muted { color: var(--text-muted); }
.inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--size-sm);
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-btn);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.inline-toggle:hover { color: var(--text); border-color: var(--blue); }
.inline-toggle input { accent-color: var(--blue); }
.inline-toggle input { margin: 0; }
.selection-hint { font-size: 11px; color: var(--text-muted); }
.selection-hint.muted { opacity: 0.6; }

.pause-badge {
  font-size: 10px;
  color: #d29922;
  background: rgba(210, 153, 34, 0.12);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}

.mode-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}
.mode-badge.review_first {
  color: #58a6ff;
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

/* Per-session pause toggle, lives on the queued card so it belongs to that session */
.pause-pill {
  font-size: 10px;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px dashed var(--border);
  background: none;
  color: var(--text-muted);
  transition: all 0.1s;
}
.pause-pill:hover { border-color: #d29922; color: #d29922; }
.pause-pill.active {
  border-style: solid;
  border-color: #d29922;
  color: #d29922;
  background: rgba(210, 153, 34, 0.12);
}

.queue-paused-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: #d29922;
  background: rgba(210, 153, 34, 0.1);
  border: 1px solid #d29922;
  border-radius: var(--radius);
}

.queue-list { display: flex; flex-direction: column; gap: 4px; }
.queue-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.queue-item.expanded { padding-bottom: 10px; }
.queue-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
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
.queue-status-chip.reviewing { color: #58a6ff; border-color: #58a6ff; }
.queue-status-chip.thinking { color: #e3b341; border-color: #e3b341; }
.queue-status-chip.ready_for_execution { color: var(--accent); border-color: var(--accent); }
.queue-status-chip.complete { color: var(--accent); border-color: var(--accent); }
.queue-status-chip.failed { color: var(--danger); border-color: var(--danger); }
.queue-status-chip.waiting_for_developer { color: #d29922; border-color: #d29922; }

.queue-actions { display: flex; gap: 8px; align-items: center; }
.terminal-toggle-btn {
  min-width: 96px;
}

.terminal-inline,
.planning-terminal {
  height: 42vh;
  min-height: 280px;
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding-top: 6px;
}
.btn.danger { color: var(--danger-hover); border-color: var(--border-strong); }
.btn.danger:not(:disabled):hover { background: var(--danger); color: #fff; border-color: var(--danger); }
.empty-state.small { font-size: 13px; color: var(--text-muted); padding: 8px 0; }
</style>
