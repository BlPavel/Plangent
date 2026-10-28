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
        <AppButton v-if="task && !editingTitle" type="button" variant="subtle" size="sm" title="Редактировать название задачи" @click="startTitleEdit">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5M3 13l.6-3L10.3 3.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4L6 12.4 3 13z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Редактировать
        </AppButton>
        <CodeButton v-if="pid && task" :project-id="pid" :task="{ id: task.id, key: task.key }" />
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

    <AppModal :model-value="editingTitle" title="Редактирование задачи" :confirm-label="savingTitle ? 'Сохранение…' : 'Сохранить'" @update:model-value="cancelTitleEdit" @confirm="saveTitle">
      <div ref="titleForm" class="task-edit-fields" @keydown.enter.prevent="saveTitle" @keydown.esc.prevent="cancelTitleEdit">
        <FormField :model-value="task?.key ?? ''" label="Ключ задачи" placeholder="PROJ-123" disabled />
        <FormField v-model="titleDraft" label="Название" placeholder="Название задачи" :disabled="savingTitle" />
      </div>
    </AppModal>

    <!-- Tab bar -->
    <div class="task-tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'analysis' }" @click="activeTab = 'analysis'">Анализ</button>
      <button class="tab-btn" :class="{ active: activeTab === 'plan' }" @click="activeTab = 'plan'">
        План
        <span v-if="planAttention" class="tab-count warn" title="Карточки ревью плана, которые ждут вашего решения или ответа планировщика">{{ planAttention }}</span>
      </button>
      <button v-if="!taskDone" class="tab-btn" :class="{ active: activeTab === 'exec' }" @click="activeTab = 'exec'">
        Выполнение
        <span v-if="attentionCount" class="tab-count warn" title="Шаги, которым нужен ваш ответ">{{ attentionCount }}</span>
        <span v-else-if="queue.frozen.value" class="tab-live" title="Очередь выполняется" />
      </button>
    </div>

    <div v-show="activeTab === 'analysis'" class="tab-body">
      <AnalysisPanel
        :project-id="pid ?? ''" :task-id="tid ?? ''" :default-agent-id="defaultAgentId"
        :sections="analysisSections" :done="taskDone" :locked-reason="analysisLockedReason" :highlights="analysisHighlights"
        :opened="openedAnalysis" :open-file="openedAnalysisFile" :agent-revision="agentRevision"
        :chats="analysisChats" :selected-chat="shownAnalysisChat" :initials="chatInitials"
        :launching="analysisLaunch.launching.value" :launch-error="analysisLaunch.error.value"
        @reload="loadAnalysis" @planning="planFromAnalysis" @select-chat="selectedAnalysisChat = $event" @remove-chat="removeChat" @launch="launchAnalysis"
      />
    </div>
    <!-- Tab: План -->
    <div v-show="activeTab === 'plan'" class="tab-body">
      <PlanPanel
        @review-attention="planAttention = $event"
        :task-id="tid ?? ''"
        :queue-frozen="queue.frozen.value"
        :plan="plan"
        :readonly="taskDone"
        :planning-message="planningMessage"
        :project-id="pid ?? ''"
        :default-agent-id="defaultAgentId"
        :planning-open="planningOpen"
        :planning-live="planningLive"
        :planning-chats="planningChats"
        :selected-planning-chat="shownPlanningChat"
        :initials="chatInitials"
        :planning-launching="planningLaunching"
        :planning-error="planningError"
        :editing-plan="editingPlan"
        :plan-content="planContent"
        :checkbox-line-previews="checkboxLinePreviews"
        :done-count="doneCount"
        :progress-pct="progressPct"
        @approve-plan="approvePlan"
        @open-planning="planningOpen = true; planningError = ''"
        @close-planning="planningOpen = false; planningMessage = ''"
        @select-planning-chat="selectedPlanningChat = $event"
        @remove-planning-chat="removeChat"
        @launch-planning="launchPlanning"
        @start-manual-edit="startManualEdit"
        @toggle-plan-edit="togglePlanEdit"
        @save-plan="savePlan"
        @cancel-edit="editingPlan = false"
        @update:plan-content="planContent = $event"
      />
    </div>

    <!-- Tab: Выполнение — plan steps and the queue on the left, the selected step's agent on the right -->
    <div v-if="!taskDone" v-show="activeTab === 'exec'" class="tab-body">
      <div v-if="!plan" class="exec-no-plan">Нет плана. Создайте план на вкладке «План».</div>
      <div v-else class="exec">
        <div class="exec-left">
          <StepPicker
            :plan="plan"
            :project-id="pid ?? ''"
            :task-id="tid ?? ''"
            :task-done="task?.status === 'done'"
            :default-agent-id="defaultAgentId"
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
          <TaskGit v-if="pid && task" :key="task.id" :project-id="pid" :task="task" :frozen="queue.frozen.value" @updated="task = $event; appStore.currentTask = $event" />
        </div>
        <aside class="exec-right">
          <StepDetailPanel :session="selectedSession" :stage-number="selectedStage + 1" :agents="agents" :steps="plan.steps" />
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useProjectsStore } from '@features/projects'
import { useTaskSessionStore } from '../stores/taskSession'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import { platform } from '@core/platform'
import type { Task, Plan, AnalysisSection, PlanStep, OrchestratorEvent } from '@core/models'
import AnalysisPanel from '../components/AnalysisPanel.vue'
import { useAgentChatLaunch } from '../composables/useAgentChatLaunch'
import { DocumentLinksKey } from '@shared/composables/documentLinks'
import { AnalysisNavigationKey } from '../composables/analysisNavigation'
import PlanPanel from '../components/PlanPanel.vue'
import StepPicker from '../components/StepPicker.vue'
import TaskGit from '../components/TaskGit.vue'
import ExecutionQueue from '../components/ExecutionQueue.vue'
import StepDetailPanel from '../components/StepDetailPanel.vue'
import StatusBadge from '@shared/ui/StatusBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { CodeButton } from '@features/code'
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
const editingTitle = ref(false)
const titleDraft = ref('')
const savingTitle = ref(false)
const titleForm = ref<HTMLElement>()

async function startTitleEdit() {
  if (!task.value) return
  titleDraft.value = task.value.title ?? ''
  editingTitle.value = true
  await nextTick()
  const input = titleForm.value?.querySelector<HTMLInputElement>('input:not(:disabled)')
  input?.focus()
  input?.select()
}

function cancelTitleEdit() {
  if (!savingTitle.value) editingTitle.value = false
}

async function saveTitle() {
  const current = task.value
  const title = titleDraft.value.trim()
  if (!current || savingTitle.value || !title) return
  if (title === current.title) {
    editingTitle.value = false
    return
  }
  savingTitle.value = true
  try {
    const updated = await api.patch<Task>(`/projects/${current.project_id}/tasks/${current.id}`, { title })
    if (task.value?.id !== current.id) return
    task.value = { ...task.value, title: updated.title }
    appStore.currentTask = task.value
    editingTitle.value = false
    appStore.toast('Название задачи сохранено', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
  finally { savingTitle.value = false }
}
const plan = ref<Plan | null>(null)
const agents = computed(() => agentsStore.agents)
const editingPlan = ref(false)
const planContent = ref('')

const activeTab = ref<'analysis' | 'plan' | 'exec'>('plan')

// Planning view: the plan next to the task's planning chats.
const planningOpen = ref(false)
const planningMessage = ref('')

const pid = computed(() => appStore.currentProject?.id)
const projectsStore = useProjectsStore()
const defaultAgentId = computed(() => projectsStore.agentFor(appStore.currentProject))
const tid = computed(() => task.value?.id)

// ——— Execution queue ———
const planningLaunch = useAgentChatLaunch(pid, tid, 'plan')
const { error: planningError, launching: planningLaunching } = planningLaunch
const analysisLaunch = useAgentChatLaunch(pid, tid, 'analysis')
const taskDone = computed(() => task.value?.status === 'done')
const analysisSections = ref<AnalysisSection[]>([])
const analysisHighlights = ref<string[]>([])
const agentRevision = ref(0)
const openedAnalysis = ref<string | null>(null), openedAnalysisFile = ref<string>()

// ——— Analysis and planning chats ———
// They are the task's agent sessions on the server, oldest first; only the selection is remembered locally.
function taskChats(role: string) {
  return [...chatStore.sessions].reverse()
    .filter(s => s.task_id === tid.value && s.role === role)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}
const analysisChats = computed(() => taskChats('analyst'))
const planningChats = computed(() => taskChats('planner'))
// null — the "new chat" panel; undefined (or a chat that is gone) — the latest chat.
const selectedAnalysisChat = ref<string | null | undefined>()
const selectedPlanningChat = ref<string | null | undefined>()
const shown = (chats: { id: string }[], selected: string | null | undefined) =>
  selected === null ? null : chats.some(c => c.id === selected) ? selected! : chats.at(-1)?.id ?? null
const shownAnalysisChat = computed(() => shown(analysisChats.value, selectedAnalysisChat.value))
const shownPlanningChat = computed(() => shown(planningChats.value, selectedPlanningChat.value))
const planningLive = computed(() => planningChats.value.some(c => ['starting', 'thinking'].includes(c.status)))
// The first message of a just-launched chat; ChatView sends it once the chat opens.
const chatInitials = ref<Record<string, ContentBlock[]>>({})
async function removeChat(id: string, name: string) {
  if (!(await appStore.confirm(`Удалить чат «${name}»? Переписка с агентом будет удалена, агент остановлен.`))) return
  try {
    await chatStore.remove(id)
    if (selectedAnalysisChat.value === id) selectedAnalysisChat.value = undefined
    if (selectedPlanningChat.value === id) selectedPlanningChat.value = undefined
  } catch (e) { appStore.toast(String(e), 'error') }
}
let analysisLoadVersion = 0
async function loadAnalysis(actor?: string) {
  if (!pid.value || !tid.value) return
  const version = ++analysisLoadVersion
  try {
    const sections = await api.get<AnalysisSection[]>(`/projects/${pid.value}/tasks/${tid.value}/analysis`)
    if (version !== analysisLoadVersion) return
    if (actor === 'agent') {
      analysisHighlights.value = sections.filter(s => {
        const old = analysisSections.value.find(x => x.id === s.id)
        return !old || old.description !== s.description || old.title !== s.title
      }).map(s => s.id)
      agentRevision.value++
    }
    analysisSections.value = sections
  } catch (e) { appStore.toast(String(e), 'error') }
}
async function openAnalysis(target: string) {
  const [slug, ...names] = target.split('/')
  const section = analysisSections.value.find(s => s.slug === slug)
  if (!section) return
  openedAnalysis.value = null
  await nextTick()
  openedAnalysis.value = section.id
  openedAnalysisFile.value = names.length ? names.join('/') : undefined
  activeTab.value = 'analysis'
  setTimeout(() => document.getElementById('analysis-' + section.id)?.scrollIntoView({ block: 'nearest' }), 0)
}
provide(AnalysisNavigationKey, { sections: analysisSections, open: openAnalysis })
provide(DocumentLinksKey, {
  exists: target => {
    const [slug, ...names] = target.split('/')
    const section = analysisSections.value.find(s => s.slug === slug)
    return !!section && (!names.length || section.files.some(f => f.name === names.join('/')))
  },
  open: openAnalysis,
})
async function launchAnalysis(request: NewChatRequest) {
  if (taskDone.value) return
  const result = await analysisLaunch.launch(request)
  if (!result) return
  chatInitials.value[result.session_id] = result.content
  await chatStore.load(result.session_id).catch(() => {}) // so the new tab is there right away
  selectedAnalysisChat.value = result.session_id
}
function planFromAnalysis() {
  planningMessage.value = 'Составь план по анализу задачи'
  planningOpen.value = true
  planningError.value = ''
  activeTab.value = 'plan'
}
const queue = useTaskQueue(pid, tid)
provide(TaskQueueKey, queue)
const selectedQueueId = ref<string | null>(null)
const selectedSession = computed(() => queue.allSessions.value.find(s => s.id === selectedQueueId.value))
const selectedStage = computed(() => queue.stages.value.findIndex(st => st.sessions.some(s => s.id === selectedQueueId.value)))
const chat = (id?: string) => id ? chatStore.sessions.find(c => c.id === id) : undefined
const planAttention = ref(0)
const attentionCount = computed(() => queue.sessions.value.filter(s => sessionState(s, chat(s.sessionId)).attention).length)

async function startQueue() {
  // The first launch is the moment to ask for (browser) notification permission: it is a click.
  platform.requestNotifications?.()
  await queue.start()
}

// A notification (or link) may point at one of the task's chats: open the step it belongs to.
// The chat list may still be loading when the task opens: a chat not found yet is looked up again once it arrives.
let routeChatPending = false
function openChatFromRoute() {
  routeChatPending = false
  const chatId = route.query.session
  if (taskDone.value) { if (typeof chatId === 'string') activeTab.value = 'plan'; return }
  if (typeof chatId !== 'string') return
  if (analysisChats.value.some(c => c.id === chatId)) { selectedAnalysisChat.value = chatId; activeTab.value = 'analysis'; return }
  if (planningChats.value.some(c => c.id === chatId)) { selectedPlanningChat.value = chatId; planningOpen.value = true; activeTab.value = 'plan'; return }
  const s = queue.allSessions.value.find(x => x.sessionId === chatId)
  if (s) { activeTab.value = 'exec'; selectedQueueId.value = s.id }
  else routeChatPending = true
}
watch(() => route.query.session, openChatFromRoute)
watch(() => chatStore.sessions.length, () => { if (routeChatPending) openChatFromRoute() })

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
    case 'analysis_updated':
      await loadAnalysis(event.actor)
      break
    case 'task_status':
      if (task.value) task.value = { ...task.value, status: event.status }
      break
    case 'plan_updated':
      // During planning we need the full content live; reload to get content + steps.
      if (planningOpen.value || !plan.value || !event.steps) {
        await loadPlan()
        if (planningLive.value) activeTab.value = 'plan'
      } else {
        plan.value = { ...plan.value, steps: event.steps as PlanStep[] }
      }
      break
    case 'queue_finished':
      await loadPlan()
      break
    case 'task_updated':
      await loadTask()
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
  await Promise.all([loadPlan(), loadAnalysis(), agentsStore.load(), queue.load()])
  if (!plan.value) activeTab.value = 'analysis'
  // Open where the work is: a running queue, or a step that waits for the developer.
  if (!taskDone.value && queue.sessions.value.length && (queue.frozen.value || attentionCount.value)) activeTab.value = 'exec'
  const first = queue.sessions.value.find(s => sessionState(s, chat(s.sessionId)).attention)
    ?? queue.sessions.value.find(s => sessionState(s).live)
  if (first) selectedQueueId.value = first.id
  openChatFromRoute()
})

onUnmounted(() => { stopEvents?.() })

// The chosen chats and the open planning view per task, so returning to the task shows them again.
function restorePlanning() {
  if (!tid.value) return
  const snap = sessionStore.load(tid.value)
  if (!snap) return
  selectedAnalysisChat.value = snap.selectedAnalysisChat
  planningOpen.value = snap.planningOpen
  selectedPlanningChat.value = snap.selectedPlanningChat
}

watch([planningOpen, selectedAnalysisChat, selectedPlanningChat], () => {
  if (!tid.value) return
  sessionStore.save(tid.value, {
    selectedAnalysisChat: selectedAnalysisChat.value,
    planningOpen: planningOpen.value,
    selectedPlanningChat: selectedPlanningChat.value,
  })
})

watch(taskDone, done => { if (done && (activeTab.value === 'exec' || typeof route.query.session === 'string')) activeTab.value = 'plan' })
const analysisLockedReason = computed(() => {
  if (taskDone.value) return 'Завершённая задача доступна только для чтения'
  const working = queue.sessions.value.some(s => {
    if (!['running', 'reviewing'].includes(s.status)) return false
    const id = s.sessionId
    return !id || chat(id)?.status !== 'waiting'
  })
  return queue.queue.value?.status === 'running' && working ? 'Анализ нельзя менять, пока агенты выполняют очередь' : ''
})

function goBack() {
  router.push('/')
}

// ——— Planning launch ———

// The planner session is created without a prompt; the developer's first message goes out
// through the chat (ChatView), and the server attaches the hidden planning briefing to it.
async function launchPlanning(request: NewChatRequest) {
  if (taskDone.value) return
  const result = await planningLaunch.launch(request)
  if (!result) return
  chatInitials.value[result.session_id] = result.content
  await chatStore.load(result.session_id).catch(() => {}) // so the new tab is there right away
  selectedPlanningChat.value = result.session_id
  planningMessage.value = ''
  activeTab.value = 'plan'
}

// Approve the plan: stop the planning agents and leave the planning view. The chats stay and can be
// continued later through "Изменить план с агентом" (the agent restarts with its conversation).
async function approvePlan() {
  await Promise.all(planningChats.value.map(c => api.post(`/agent-sessions/${c.id}/close`, {}).catch(() => { /* already stopped */ })))
  planningOpen.value = false
  planningMessage.value = ''
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
.task-edit-fields { display: flex; flex-direction: column; gap: var(--sp-3); }
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

