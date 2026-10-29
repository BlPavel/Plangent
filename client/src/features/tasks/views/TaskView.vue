<template>
  <div class="task-view">
    <WorkHeader v-if="task" :task="task" :state="entry?.state ?? null" :branch="workspace?.branch ?? task.branch_name" :main-folder="inMainFolder" :menu="menuItems" @back="goBack" />
    <WorkStages v-if="task" :task="task" :state="entry?.state ?? null" :has-plan="!!plan" @select="activeTab = $event as Tab" />

    <AppModal :model-value="editingTitle" :title="task?.kind === 'errand' ? 'Поручение' : 'Задача'" :confirm-label="savingTitle ? 'Сохранение…' : 'Сохранить'" @update:model-value="cancelTitleEdit" @confirm="saveTitle">
      <div ref="titleForm" class="task-edit-fields" @keydown.enter.prevent="saveTitle" @keydown.esc.prevent="cancelTitleEdit">
        <FormField v-model="numberDraft" label="Номер задачи" placeholder="PROJ-123" :disabled="savingTitle" />
        <FormField v-model="titleDraft" label="Описание" placeholder="Что нужно сделать" :disabled="savingTitle" />
      </div>
    </AppModal>

    <StartExecutionDialog v-if="showStart && task" v-model="showStart" :task="task" :ordinary="canChooseBranch" :group="appStore.currentProject?.kind === 'group'" :busy="startingWork" :error="startError || queue.lastError.value" :workspace="workspace" @start="startQueue" />
    <!-- Tab bar: five tabs for a task, three for an errand -->
    <div class="task-tab-bar">
      <button v-for="t in tabs" :key="t.id" class="tab-btn" :class="{ active: activeTab === t.id }" @click="activeTab = t.id">
        {{ t.label }}
        <span v-if="t.count" class="tab-count warn" :title="t.countTitle">{{ t.count }}</span>
        <span v-else-if="t.live" class="tab-live" title="Очередь выполняется" />
      </button>
    </div>

    <div v-if="activeTab === 'chat' && task" class="tab-body"><WorkChat :key="task.id" :task="task" :workspace="workspace" :default-agent-id="defaultAgentId" show-rounds @open-check="activeTab = 'check'" /></div>
    <div v-if="activeTab === 'check' && task" class="tab-body">
      <!-- Проверка is the «Код» screen of the work's folder: files, diff, remarks with the agent, commits, МР. -->
      <p v-if="workspace && workspace.status !== 'ready'" class="exec-no-plan">{{ workspace.status === 'failed' ? 'Рабочее место недоступно: ' + workspace.error : 'Готовлю рабочее место…' }}</p>
      <CodeTab
        v-else-if="isOrdinary" :key="task.id + (workspace?.id ?? '')" :project-id="task.project_id" :workspace-id="workspace?.id ?? null"
        :task="{ id: task.id, key: task.key }" :default-agent-id="executorAgentId" work
      >
        <template #actions>
          <span v-if="entry?.state.status === 'reviewing'" class="check-note">🤖 Идёт ревью агентом…</span>
          <AppButton size="sm" :disabled="taskDone || reviewStarting || entry?.state.status === 'reviewing'" title="Агент-ревьюер проверит изменения работы; замечания появятся справа" @click="runReview">🤖 Ревью агентом</AppButton>
          <AppButton size="sm" variant="blue" @click="activeTab = 'finish'">Завершение →</AppButton>
        </template>
      </CodeTab>
      <WorkCheck v-else :key="task.id" :task="task" :default-agent-id="defaultAgentId" @checked="activeTab = 'finish'" />
    </div>
    <div v-if="activeTab === 'finish' && task" class="tab-body"><WorkFinish :key="task.id" :task="task" :workspace="workspace" @closed="onClosed" /></div>
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
    <div v-if="!taskDone && task?.kind !== 'errand'" v-show="activeTab === 'exec'" class="tab-body">
      <div v-if="!plan" class="exec-no-plan">Нет плана. Создайте план на вкладке «План».</div>
      <div v-else class="exec">
        <div class="exec-left">
          <TaskGit v-if="pid && task && legacyBranch" :key="task.id" :project-id="pid" :task="task" :frozen="queue.frozen.value" @updated="task = $event; appStore.currentTask = $event" />
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
            @start="showStart = true"
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
import StartExecutionDialog from '../components/StartExecutionDialog.vue'
import TaskGit from '../components/TaskGit.vue'
import WorkChat from '../components/WorkChat.vue'
import WorkCheck from '../components/WorkCheck.vue'
import WorkFinish from '../components/WorkFinish.vue'
import WorkHeader from '../components/WorkHeader.vue'
import WorkStages from '../components/WorkStages.vue'
import { useWorkStore } from '../stores/work'
import { useWorkActions } from '../composables/useWorkActions'
import { workApi, workspacesApi } from '../api'
import ExecutionQueue from '../components/ExecutionQueue.vue'
import AppButton from '@shared/ui/AppButton.vue'
import StepDetailPanel from '../components/StepDetailPanel.vue'
import AppModal from '@shared/ui/AppModal.vue'
import { type MenuItem } from '@shared/ui/AppMenu.vue'
import FormField from '@shared/ui/FormField.vue'
import { CodeTab } from '@features/code'
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
const titleDraft = ref(''), numberDraft = ref('')
const savingTitle = ref(false)
const titleForm = ref<HTMLElement>()

async function startTitleEdit() {
  if (!task.value) return
  titleDraft.value = task.value.title ?? ''
  numberDraft.value = task.value.external_key ?? ''
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
  const title = titleDraft.value.trim(), number = numberDraft.value.trim()
  if (!current || savingTitle.value) return
  if (!title && !number) { appStore.toast('Укажите номер задачи или описание', 'error'); return }
  if (title === (current.title ?? '') && number === (current.external_key ?? '')) {
    editingTitle.value = false
    return
  }
  savingTitle.value = true
  try {
    const updated = await api.patch<Task>(`/projects/${current.project_id}/tasks/${current.id}`, { title, external_key: number || null })
    if (task.value?.id !== current.id) return
    task.value = { ...task.value, title: updated.title, external_key: updated.external_key }
    appStore.currentTask = task.value
    editingTitle.value = false
    void work.load(pid.value ? [pid.value] : [])
    appStore.toast('Сохранено', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
  finally { savingTitle.value = false }
}
const plan = ref<Plan | null>(null)
const agents = computed(() => agentsStore.agents)
const editingPlan = ref(false)
const planContent = ref('')

type Tab = 'chat' | 'analysis' | 'plan' | 'exec' | 'check' | 'finish'
const activeTab = ref<Tab>('plan')
const showStart = ref(false), startingWork = ref(false), startError = ref('')
const work = useWorkStore(), actions = useWorkActions()
const entry = computed(() => work.entries.find(e => e.task.id === task.value?.id) ?? null)
const workspace = computed(() => entry.value?.workspace ?? null)
// A task gets its own workspace on the first start. Started tasks and group work go on in the main folder.
const isOrdinary = computed(() => appStore.currentProject?.kind === 'project')
const canChooseBranch = computed(() => isOrdinary.value && !task.value?.base_commit && (!workspace.value || workspace.value.status === 'failed'))
const legacyBranch = computed(() => !workspace.value && task.value?.kind !== 'errand' && !canChooseBranch.value)
/** Started without its own folder: the work changes the project's main folder. */
const inMainFolder = computed(() => isOrdinary.value && !workspace.value && !!task.value?.base_commit && !task.value?.closed_at)
/** Remarks of Проверка go by default to the agent who did the work. */
const executorAgentId = computed(() => chatStore.sessions.find(s => s.task_id === tid.value && ['errand', 'task-chat', 'executor'].includes(s.role))?.agent_id ?? defaultAgentId.value)
const reviewStarting = ref(false)
async function runReview() {
  if (!task.value || reviewStarting.value) return
  reviewStarting.value = true
  try { chatStore.put(await workApi.review(task.value.project_id, task.value.id) as import('@features/agent-chat').ChatSession); void work.load(pid.value ? [pid.value] : []) }
  catch (cause) { appStore.toast(String(cause).replace(/^Error:\s*/, ''), 'error') }
  finally { reviewStarting.value = false }
}

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
watch(() => task.value?.id, () => { if (task.value?.kind === 'errand') activeTab.value = 'chat' }, { immediate: true })
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

interface TabItem { id: Tab; label: string; count?: number; countTitle?: string; live?: boolean }
const tabs = computed<TabItem[]>(() => {
  if (!task.value) return []
  const check: TabItem = { id: 'check', label: 'Проверка', count: entry.value?.state.counts.remarks, countTitle: 'Замечания, по которым нужно решение' }
  const finish: TabItem = { id: 'finish', label: 'Завершение' }
  if (task.value.kind === 'errand') return [{ id: 'chat', label: 'Чат' }, check, finish]
  return [
    { id: 'analysis', label: 'Анализ' },
    { id: 'plan', label: 'План', count: planAttention.value, countTitle: 'Карточки ревью плана, которые ждут вашего решения или ответа планировщика' },
    ...(taskDone.value ? [] : [{ id: 'exec' as const, label: 'Выполнение', count: attentionCount.value, countTitle: 'Шаги, которым нужен ваш ответ', live: queue.frozen.value }]),
    check, finish,
  ]
})
function applyRouteTab() {
  const wanted = route.query.tab
  if (typeof wanted === 'string' && tabs.value.some(t => t.id === wanted)) activeTab.value = wanted as Tab
}
watch(() => route.query.tab, applyRouteTab)

const menuItems = computed<MenuItem[]>(() => {
  const t = task.value
  if (!t) return []
  return [
    { label: 'Номер и описание…', action: () => void startTitleEdit() },
    ...(!t.closed_at && t.status !== 'done' ? [{ label: 'Закрыть работу', hint: 'Без пуша и МР; можно открыть снова', action: () => void closeWork() }] : []),
    ...(t.kind === 'errand' && !t.closed_at ? [
      { label: 'Добавить план', hint: 'Поручение станет задачей, ветка сохранится', action: () => void addPlanToErrand() },
      { separator: true as const },
      { heading: 'Отменить поручение' },
      { label: 'Выбросить изменения', danger: true, action: () => void cancelErrand('discard') },
      { label: 'Оставить, посмотрю позже', action: () => void cancelErrand('keep') },
    ] : []),
    ...(t.status !== 'done' && t.kind !== 'errand' && !workspace.value ? [{ label: 'Отметить выполненной', hint: 'Без Завершения', action: () => void markDoneTask() }] : []),
    ...(t.status === 'done' ? [{ label: 'Вернуть в работу', action: () => void reopenTask() }] : []),
    { separator: true },
    { label: 'Удалить', danger: true, action: () => void deleteCurrentTask() },
  ]
})
async function addPlanToErrand() {
  if (!task.value) return
  const updated = await actions.addPlan(task.value)
  if (!updated) return
  task.value = updated; appStore.currentTask = updated
  activeTab.value = 'analysis'
  void work.load(pid.value ? [pid.value] : [])
  appStore.toast('Добавлены вкладки «Анализ» и «План»', 'success')
}
async function cancelErrand(mode: 'keep' | 'discard') {
  if (!task.value) return
  if (!await actions.cancel(task.value, mode)) return
  await work.load(pid.value ? [pid.value] : [])
  appStore.toast('Поручение отменено', 'success')
  goBack()
}
async function closeWork() {
  if (!task.value) return
  if (!await appStore.confirm('Закрыть работу? Рабочее место будет убрано, ветка останется. Открыть снова можно из списка «Готово».', { confirmLabel: 'Закрыть работу' })) return
  const closed = await actions.close(task.value)
  if (closed) { appStore.toast('Работа закрыта', 'success'); await onClosed(closed) }
}
async function onClosed(closed: Task) {
  task.value = closed; appStore.currentTask = closed
  await work.load(pid.value ? [pid.value] : [])
  goBack()
}

async function startQueue(options: { base_branch?: string; branch_name?: string; auto_review?: boolean }) {
  if (startingWork.value || !task.value) return
  startingWork.value = true; startError.value = ''
  // The first launch is the moment to ask for (browser) notification permission: it is a click.
  platform.requestNotifications?.()
  try {
    // «Повторить» after a failed preparation: the place is rebuilt on the same branch before the queue starts.
    if (workspace.value?.status === 'failed') await workspacesApi.recreate(task.value.project_id, workspace.value.id, true)
    if (await queue.start(options)) showStart.value = false
  } catch (cause) { startError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { startingWork.value = false; if (pid.value) void work.load([pid.value]) }
}

// A notification (or link) may point at one of the task's chats: open the step it belongs to.
// The chat list may still be loading when the task opens: a chat not found yet is looked up again once it arrives.
let routeChatPending = false
function openChatFromRoute() {
  routeChatPending = false
  const chatId = route.query.session
  // An errand opens on its chat unless a link asked for a tab (a notification opens «Проверка»).
  if (task.value?.kind === 'errand') { if (!route.query.tab) activeTab.value = 'chat'; return }
  const direct = chatStore.sessions.find(s => s.id === chatId && s.task_id === tid.value)
  if (direct && ['task-chat', 'task-reviewer'].includes(direct.role)) { activeTab.value = 'check'; return }
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
      activeTab.value = 'check'
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
  void work.load(appStore.currentProject ? [appStore.currentProject.id] : [])
  await loadTask()
  restorePlanning()
  await Promise.all([loadPlan(), loadAnalysis(), agentsStore.load(), queue.load()])
  if (task.value?.kind === 'errand') activeTab.value = 'chat'
  else if (queue.queue.value?.status === 'finished') activeTab.value = 'check'
  else if (!plan.value) activeTab.value = 'analysis'
  // Open where the work is: a running queue, or a step that waits for the developer.
  if (task.value?.kind !== 'errand' && !taskDone.value && queue.sessions.value.length && (queue.frozen.value || attentionCount.value)) activeTab.value = 'exec'
  const first = queue.sessions.value.find(s => sessionState(s, chat(s.sessionId)).attention)
    ?? queue.sessions.value.find(s => sessionState(s).live)
  if (first) selectedQueueId.value = first.id
  applyRouteTab()
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
  if (!task.value) return
  if (await actions.reopen(task.value)) { appStore.toast('Работа снова открыта', 'success'); await loadTask() }
}

async function deleteCurrentTask() {
  if (!task.value) return
  const id = task.value.id
  if (!await actions.remove(task.value)) return
  sessionStore.clear(id)
  appStore.toast('Удалено', 'success')
  router.push('/')
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
.check-note { font-size: 12px; color: var(--blue-hover); white-space: nowrap; }
.exec { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(360px, 45%) minmax(0, 1fr); }
.exec-left { min-height: 0; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--border); }
.exec-right { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
</style>

