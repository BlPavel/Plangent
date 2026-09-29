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
        <AppButton v-else variant="ghost" size="sm" @click="reopenTask">↺ Вернуть в работу</AppButton>
        <AppButton variant="danger-ghost" size="sm" @click="deleteCurrentTask">
          <IconTrash /> Удалить
        </AppButton>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="task-tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'plan' }" @click="activeTab = 'plan'">План</button>
      <button class="tab-btn" :class="{ active: activeTab === 'exec' }" @click="activeTab = 'exec'">
        Выполнение
        <span v-if="attentionCount" class="tab-count warn" title="Шаги, которым нужен ваш ответ">{{ attentionCount }}</span>
        <span v-else-if="queue.frozen.value" class="tab-live" title="Очередь выполняется" />
      </button>
    </div>

    <!-- Tab: План -->
    <div v-show="activeTab === 'plan'" class="tab-body">
      <PlanPanel
        :plan="plan"
        :project-id="pid ?? ''"
        :default-agent-id="appStore.currentProject?.default_agent_id"
        :planning-active="planningActive"
        :planning-draft="planningDraft"
        :planning-session-id="planningSessionId"
        :planning-initial="planningInitial"
        :planning-launching="planningLaunching"
        :planning-error="planningError"
        :editing-plan="editingPlan"
        :plan-content="planContent"
        :checkbox-line-previews="checkboxLinePreviews"
        :done-count="doneCount"
        :progress-pct="progressPct"
        @approve-plan="approvePlan"
        @open-planning="planningDraft = true; planningError = ''"
        @cancel-planning="planningDraft = false"
        @launch-planning="launchPlanning"
        @start-manual-edit="startManualEdit"
        @toggle-plan-edit="togglePlanEdit"
        @save-plan="savePlan"
        @cancel-edit="editingPlan = false"
        @update:plan-content="planContent = $event"
      />
    </div>

    <!-- Tab: Выполнение — plan steps and the queue on the left, the selected step's agent on the right -->
    <div v-show="activeTab === 'exec'" class="tab-body">
      <div v-if="!plan" class="exec-no-plan">Нет плана. Создайте план на вкладке «План».</div>
      <div v-else class="exec">
        <div class="exec-left">
          <StepPicker
            :plan="plan"
            :project-id="pid ?? ''"
            :task-id="tid ?? ''"
            :task-done="task?.status === 'done'"
            :default-agent-id="appStore.currentProject?.default_agent_id"
            @plan-changed="plan = $event"
          />
          <ExecutionQueue
            :agents="agents"
            :steps="plan.steps"
            :selected-id="selectedQueueId"
            :task-done="task?.status === 'done'"
            @select="selectedQueueId = selectedQueueId === $event ? null : $event"
            @open="selectedQueueId = $event"
            @start="startQueue"
          />
        </div>
        <aside class="exec-right">
          <StepDetailPanel :session="selectedSession" :stage-number="selectedStage + 1" :agents="agents" :steps="plan.steps" />
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useTaskSessionStore } from '../stores/taskSession'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import { platform } from '@core/platform'
import type { Task, Plan, RunStartResult, PlanStep, OrchestratorEvent } from '@core/models'
import PlanPanel from '../components/PlanPanel.vue'
import StepPicker from '../components/StepPicker.vue'
import ExecutionQueue from '../components/ExecutionQueue.vue'
import StepDetailPanel from '../components/StepDetailPanel.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { useChatStore, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import { useTaskQueue, TaskQueueKey } from '../composables/useTaskQueue'
import { sessionState } from '../utils/queue-status'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const sessionStore = useTaskSessionStore()
const chatStore = useChatStore()

const task = ref<Task | null>(appStore.currentTask)
const plan = ref<Plan | null>(null)
const agents = computed(() => agentsStore.agents)
const editingPlan = ref(false)
const planContent = ref('')

const activeTab = ref<'plan' | 'exec'>('plan')

// Planning state: a draft shows the agent picker next to the plan; active means a planner session exists.
const planningDraft = ref(false)
const planningInitial = ref<ContentBlock[] | undefined>()
const planningError = ref('')
const planningLaunching = ref(false)
const planningActive = ref(false)
const planningRunId = ref<string | null>(null)
const planningSessionId = ref<string | null>(null)

const pid = computed(() => appStore.currentProject?.id)
const tid = computed(() => task.value?.id)

// ——— Execution queue ———
const queue = useTaskQueue(pid, tid)
provide(TaskQueueKey, queue)
const selectedQueueId = ref<string | null>(null)
const selectedSession = computed(() => queue.allSessions.value.find(s => s.id === selectedQueueId.value))
const selectedStage = computed(() => queue.stages.value.findIndex(st => st.sessions.some(s => s.id === selectedQueueId.value)))
const chat = (id?: string) => id ? chatStore.sessions.find(c => c.id === id) : undefined
const attentionCount = computed(() => queue.sessions.value.filter(s => sessionState(s, chat(s.sessionId), chat(s.reviewSessionId)).attention).length)

async function startQueue() {
  // The first launch is the moment to ask for (browser) notification permission: it is a click.
  platform.requestNotifications?.()
  await queue.start()
}

// A notification (or link) may point at one of the task's chats: open the step it belongs to.
function openChatFromRoute() {
  const chatId = route.query.session
  if (typeof chatId !== 'string') return
  if (chatId === planningSessionId.value) { activeTab.value = 'plan'; return }
  const s = queue.allSessions.value.find(x => x.sessionId === chatId || x.reviewSessionId === chatId)
  if (s) { activeTab.value = 'exec'; selectedQueueId.value = s.id }
}
watch(() => route.query.session, openChatFromRoute)

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

let stopEvents: (() => void) | null = null

async function handleEvent(event: OrchestratorEvent) {
  if (event.taskId !== tid.value) return
  queue.applyEvent(event)
  switch (event.type) {
    case 'task_status':
      if (task.value) task.value = { ...task.value, status: event.status }
      break
    case 'plan_updated':
      // During planning we need the full content live; reload to get content + steps.
      if (planningActive.value || !plan.value || !event.steps) {
        await loadPlan()
        if (planningActive.value) activeTab.value = 'plan'
      } else {
        plan.value = { ...plan.value, steps: event.steps as PlanStep[] }
      }
      break
    case 'queue_finished':
      await loadPlan()
      break
  }
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

onMounted(async () => {
  stopEvents = onServerEvent<OrchestratorEvent>(e => { void handleEvent(e) })
  await loadTask()
  restorePlanning()
  await Promise.all([loadPlan(), agentsStore.load(), queue.load()])
  // Open where the work is: a running queue, or a step that waits for the developer.
  if (queue.sessions.value.length && (queue.frozen.value || attentionCount.value)) activeTab.value = 'exec'
  const first = queue.sessions.value.find(s => sessionState(s, chat(s.sessionId), chat(s.reviewSessionId)).attention)
    ?? queue.sessions.value.find(s => sessionState(s).live)
  if (first) selectedQueueId.value = first.id
  openChatFromRoute()
})

onUnmounted(() => { stopEvents?.() })

// Planning state per task, so returning to the task re-attaches the still-running planner.
function restorePlanning() {
  if (!tid.value) return
  const snap = sessionStore.load(tid.value)
  if (!snap) return
  planningActive.value = snap.planningActive
  planningRunId.value = snap.planningRunId
  planningSessionId.value = snap.planningSessionId
}

watch([planningActive, planningRunId, planningSessionId], () => {
  if (!tid.value) return
  sessionStore.save(tid.value, {
    planningActive: planningActive.value,
    planningRunId: planningRunId.value,
    planningSessionId: planningSessionId.value,
  })
})

function goBack() {
  router.push('/')
}

// ——— Planning launch ———

// The planner session is created without a prompt; the developer's first message goes out
// through the chat (ChatView), and the server attaches the hidden planning briefing to it.
async function launchPlanning({ content, ...options }: NewChatRequest) {
  if (!pid.value || !tid.value || !options.agent_id) return
  planningLaunching.value = true
  planningError.value = ''
  try {
    const result = await api.post<RunStartResult>(
      `/projects/${pid.value}/tasks/${tid.value}/runs`,
      { purpose: 'plan', agent_id: options.agent_id, model: options.model || undefined, mode: options.mode, config: options.config },
    )
    planningInitial.value = content
    planningDraft.value = false
    planningActive.value = true
    planningRunId.value = result.run.id
    planningSessionId.value = result.session_id
    activeTab.value = 'plan'
  } catch (e: unknown) {
    planningError.value = String(e)
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
  planningActive.value = false
  planningRunId.value = null
  planningSessionId.value = null
  planningInitial.value = undefined
  await loadPlan()
  appStore.toast('План утверждён', 'success')
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

async function reopenTask() {
  if (!pid.value || !tid.value) return
  try {
    await api.post(`/projects/${pid.value}/tasks/${tid.value}/reopen`, {})
    appStore.toast('Задача снова в работе', 'success')
    await loadTask()
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function deleteCurrentTask() {
  if (!pid.value || !tid.value) return
  if (!(await appStore.confirm(`Удалить задачу «${task.value?.key}»? Действие необратимо — план, запуски и сессии будут удалены.`))) return
  const id = tid.value
  try {
    await api.delete(`/projects/${pid.value}/tasks/${id}`)
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
.tab-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.tab-count.warn { background: var(--warning); color: #0d1117; }
.tab-live { width: 7px; height: 7px; border-radius: 50%; background: var(--blue-hover); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* Tab bodies */
.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.exec-no-plan { font-size: 13px; color: var(--text-muted); padding: 16px 20px; }
.exec { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(360px, 45%) minmax(0, 1fr); }
.exec-left { min-height: 0; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--border); }
.exec-right { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
</style>
