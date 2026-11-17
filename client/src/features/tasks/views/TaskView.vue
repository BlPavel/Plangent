<template>
  <div ref="viewRoot" class="task-view" :class="{ deleting }">
    <div v-if="deleting" class="deleting-note" role="status"><i class="deleting-spin" />Удаляется…</div>
    <WorkHeader v-if="task" :task="task" :branch="workspace?.branch ?? task.branch_name" :main-folder="inMainFolder" :menu="menuItems" @back="goBack" />
    <WorkStages v-if="task" :task="task" :state="entry?.state ?? null" :has-plan="hasPlan" :active="activeTab ?? ''" :tabs="tabs" :stages="task.kind === 'errand' ? [] : stages" :exec-done="execDone" :locked="!!analysisLockedReason" :drafting="drafting" @select="activeTab = $event as Tab" @complete="completeStage" @skip="skipStage" />

    <AppModal :model-value="editingTitle" :title="task?.kind === 'errand' ? 'Редактировать поручение' : 'Редактировать задачу'" :confirm-label="savingTitle ? 'Сохранение…' : 'Сохранить'" @update:model-value="cancelTitleEdit" @confirm="saveTitle">
      <div ref="titleForm" class="task-edit-fields" @keydown.enter.prevent="saveTitle" @keydown.esc.prevent="cancelTitleEdit">
        <FormField v-model="numberDraft" label="Номер задачи" placeholder="PROJ-123" :disabled="savingTitle" />
        <FormField v-model="titleDraft" label="Описание" placeholder="Что нужно сделать" :disabled="savingTitle" />
      </div>
    </AppModal>


    <div v-if="activeTab === 'chat' && task" class="tab-body"><WorkChat :key="task.id" :task="task" :workspace="workspace" :default-agent-id="defaultAgentId" /></div>
    <div v-if="activeTab === 'check' && task" class="tab-body">
      <!-- Проверка is the «Код» screen of the work's folder: files, diff, remarks with the agent, commits, МР. -->
      <!-- A closed work has no folder of its own any more: the main folder's changes are not its own. -->
      <AppEmptyState v-if="isOrdinary && workClosed && !workspace" title="Работа закрыта">
        {{ task.branch_name ? `Весь закоммиченный код остался в ветке «${task.branch_name}». Её можно открыть в основной папке.` : 'Закоммиченный код остался в ветке.' }}
        <template #actions><AppButton size="sm" @click="reopenTask">Открыть снова</AppButton></template>
      </AppEmptyState>
      <p v-else-if="workspace && workspace.status !== 'ready'" class="exec-no-plan">{{ workspace.status === 'failed' ? 'Рабочее место недоступно: ' + workspace.error : 'Готовлю рабочее место…' }}</p>
      <CodeTab
        v-else-if="isOrdinary" :key="task.id + (workspace?.id ?? '')" :project-id="task.project_id" :workspace-id="workspace?.id ?? null"
        :task="{ id: task.id, key: task.key, kind: task.kind }" :default-agent-id="executorAgentId" :finish-blocked="workClosed ? 'Работа закрыта' : ''" work :agent-review="agentReview" @close-work="closeWork"
      />
      <WorkCheck v-else :key="task.id" :task="task" :default-agent-id="defaultAgentId" @close="closeWork" />
    </div>
    <div v-show="activeTab === 'analysis'" class="tab-body">
      <AnalysisPanel
        :workspace-id="workspace?.id ?? null"
        :project-id="pid ?? ''" :task-id="tid ?? ''" :default-agent-id="defaultAgentId"
        :sections="analysisSections" :done="taskDone" :locked-reason="analysisLockedReason" :highlights="analysisHighlights"
        :opened="openedAnalysis" :open-file="openedAnalysisFile" :agent-revision="agentRevision"
        :chats="analysisChats" :selected-chat="shownAnalysisChat" :initials="chatInitials"
        :launching="analysisLaunch.launching.value" :launch-error="analysisLaunch.error.value"
        @reload="loadAnalysis" @select-chat="selectedAnalysisChat = $event" @remove-chat="removeChat" @launch="launchAnalysis"
      />
    </div>
    <!-- Tabs: Архитектура and QA are the same panel for two kinds of document.
         v-show sits on the panel itself: on a plain div of a v-for over a constant list Vue never updates it. -->
    <MaterialPanel
      v-for="t in materialTypes" v-show="activeTab === t" :key="t" class="tab-body"
      :workspace-id="workspace?.id ?? null"
      :type="t" :material="materials[t]" :opened-identifier="openedMaterial?.type === t ? openedMaterial.identifier : undefined" :stage="stages.find(s => s.stage === t)" :project-id="pid ?? ''" :task-id="tid ?? ''" :default-agent-id="defaultAgentId"
      :locked-reason="analysisLockedReason" :done="taskDone" :chats="materialChats(t)" :selected-chat="shownMaterialChat(t)" :initials="chatInitials"
      :launching="materialLaunch[t].launching.value" :launch-error="materialLaunch[t].error.value" :live="materialChats(t).some(c => ['starting', 'thinking'].includes(c.status))"
      @select-chat="selectedMaterialChat[t] = $event" @remove-chat="removeChat" @launch="launchMaterial(t, $event)" @reload="loadMaterial(t); loadStages()" @review-attention="materialAttention[t] = $event" @editing="materialEditing[t] = $event" @approve="approveMaterial(t)"
    />
    <!-- Tab: План -->
    <div v-show="activeTab === 'plan'" class="tab-body">
      <PlanPanel
        :workspace-id="workspace?.id ?? null"
        @review-attention="planAttention = $event"
        :task-id="tid ?? ''"
        :queue-frozen="queue.frozen.value"
        :plan="plan"
        :readonly="taskDone"
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
        :stale-draft="stalePlanDraft"
        @reload-draft="reloadPlanDraft"
        :done-count="doneCount"
        :progress-pct="progressPct"
        @approve-plan="approvePlan"
        @open-planning="planningOpen = true; planningError = ''"
        @close-planning="planningOpen = false"
        @select-planning-chat="selectedPlanningChat = $event"
        @remove-planning-chat="removeChat"
        @launch-planning="launchPlanning"
        @start-manual-edit="startManualEdit"
        @toggle-plan-edit="togglePlanEdit"
        @save-plan="savePlan"
        @cancel-edit="cancelPlanDraft"
        @update:plan-content="planContent = $event"
      />
    </div>

    <!-- Execution: plan on the left; queue or selected agent on the right. -->
    <div v-if="!taskDone && task?.kind !== 'errand'" v-show="activeTab === 'exec'" class="tab-body">
      <div v-if="!plan || !hasPlan" class="exec-no-plan">Нет плана. Создайте план на вкладке «План».</div>
      <ExecutionWorkspace v-else :agent-open="!!selectedSession" @back="returnToQueue">
        <template #plan>
          <StepPicker
            :plan="plan"
            :project-id="pid ?? ''"
            :task-id="tid ?? ''"
            :task-done="task?.status === 'done'"
            :default-agent-id="defaultAgentId"
            @plan-changed="plan = $event"
          />
        </template>
        <template #queue>
          <ExecutionBranch v-if="task && isOrdinary && !legacyBranch" :key="task.id" v-model="executionPlace" :task="task" :workspace="workspace" :configurable="canChooseBranch && workspace?.status !== 'failed' && !queue.frozen.value" :locked-reason="queue.frozen.value || entry?.state.agentWorking || entry?.state.counts.waiting ? 'Остановите очередь и агентов перед сменой ветки' : ''" @changed="task = $event; appStore.currentTask = $event" />
          <TaskGit v-if="pid && task && legacyBranch" :key="task.id" :project-id="pid" :task="task" :frozen="queue.frozen.value" @updated="task = $event; appStore.currentTask = $event" />
          <ExecutionQueue
            :agents="agents"
            :steps="plan.steps"
            :selected-id="selectedQueueId"
            :task-done="task?.status === 'done'"
            @select="selectedQueueId = $event"
            @open="selectedQueueId = $event"
            @start="startQueue"
          />
        </template>
        <template #agent>
          <StepDetailPanel :workspace-id="workspace?.id ?? null" :session="selectedSession" :stage-number="selectedStage + 1" :agents="agents" :steps="plan.steps" />
        </template>
      </ExecutionWorkspace>
    </div>
  </div>
</template>

<script setup lang="ts">
import { tasksEndpoints } from '../api'
import { agentChatEndpoints } from '@features/agent-chat'

import { useDocumentDraft } from '@core/composables/useDraft'
import { ref, computed, onMounted, onUnmounted, watch, provide, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useProjectsStore } from '@features/projects'
import { useTaskSessionStore } from '../stores/taskSession'
import { onServerEvent } from '@core/api/events'
import { platform } from '@core/platform'
import type { Task, Plan, AnalysisSection, PlanStep, OrchestratorEvent, Material, MaterialType, PreparationStage, StageSummary } from '@contracts'
import AnalysisPanel from '../components/AnalysisPanel.vue'
import { useAgentChatLaunch } from '../composables/useAgentChatLaunch'
import { DocumentLinksKey } from '@shared/markdown'
import { resolveDocumentTarget } from '../utils/document-target'
import { AnalysisNavigationKey } from '../composables/analysisNavigation'
import PlanPanel from '../components/PlanPanel.vue'
import MaterialPanel from '../components/MaterialPanel.vue'
import StepPicker from '../components/StepPicker.vue'
import ExecutionBranch from '../components/ExecutionBranch.vue'
import type { WorkPlace } from '../components/WhereToWork.vue'
import { slug } from '@shared/utils/slug'
import TaskGit from '../components/TaskGit.vue'
import WorkChat from '../components/WorkChat.vue'
import WorkCheck from '../components/WorkCheck.vue'
import WorkHeader from '../components/WorkHeader.vue'
import WorkStages from '../components/WorkStages.vue'
import { useWorkStore } from '../stores/work'
import { workStageIndex, workStagesOf } from '../utils/work-state'
import { isRemoving, useWorkActions } from '../composables/useWorkActions'
import { workApi, workspacesApi, preparationApi } from '../api'
import ExecutionWorkspace from '../components/ExecutionWorkspace.vue'
import ExecutionQueue from '../components/ExecutionQueue.vue'
import StepDetailPanel from '../components/StepDetailPanel.vue'
import AppModal from '@shared/ui/AppModal.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppEmptyState from '@shared/ui/AppEmptyState.vue'
import { type MenuItem } from '@shared/ui/AppMenu.vue'
import FormField from '@shared/ui/FormField.vue'
import { CodeTab, gitApi } from '@features/code'
import { useChatStore, useComposerReveal, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
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
    const updated = await tasksEndpoints.patchProjectsByProjectIdTasksByTaskId({ params: { projectId: current.project_id, taskId: current.id }, body: { title, external_key: number || null } })
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
const { active: editingPlan, text: planContent, stale: stalePlanDraft, start: startPlanDraft, reload: reloadPlanDraft, cancel: cancelPlanDraft } = useDocumentDraft(() => `task:${tid.value}:plan-edit`, () => ({ text: plan.value?.content ?? '', version: plan.value?.version ?? 0 }))

type Tab = 'chat' | 'analysis' | 'architecture' | 'qa' | 'plan' | 'exec' | 'check'
// No tab until the task is loaded: onMounted picks the stage the work is on, so no other tab flashes first.
const activeTab = ref<Tab | null>(null)
const startingWork = ref(false)
const executionPlace = ref<WorkPlace>({ place: 'new', branch_name: '', base_branch: '', branch: '' })
watch(() => task.value?.id, () => {
  const current = task.value
  if (!current) return
  executionPlace.value = { place: 'new', branch_name: current.branch_name || slug(current.external_key || current.title || current.key), base_branch: current.base_branch || '', branch: '' }
}, { immediate: true })
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
/** The review agent chosen when the work was created (older errands keep it in their chat); the form falls back to the project's one. */
const reviewPreferred = computed(() => task.value?.review_agent
  ?? chatStore.sessions.find(s => s.task_id === tid.value && s.role === 'errand')?.metadata.review_agent as { agent_id: string; model?: string; effort?: string } | undefined)
async function runReview(body: import('@contracts').WorkPOSTTasksTaskIdReviewBody = {}) {
  if (!task.value || reviewStarting.value) return false
  reviewStarting.value = true
  try { chatStore.put(await workApi.review(task.value.project_id, task.value.id, body) as import('@features/agent-chat').ChatSession); void work.load(pid.value ? [pid.value] : []); return true }
  catch (cause) { appStore.toast(String(cause).replace(/^Error:\s*/, ''), 'error'); return false }
  finally { reviewStarting.value = false }
}
/** Проверка's agent review sits above the remarks, as in «Код»; the work launches it. */
const agentReview = computed(() => taskDone.value ? null : { preferred: reviewPreferred.value, run: runReview })

// Planning view: the plan next to the task's planning chats.
const planningOpen = ref(false)

const pid = computed(() => appStore.currentProject?.id)
const projectsStore = useProjectsStore()
const defaultAgentId = computed(() => projectsStore.agentFor(appStore.currentProject))
const tid = computed(() => task.value?.id)

// ——— Execution queue ———
const planningLaunch = useAgentChatLaunch(pid, tid, 'plan')
const { error: planningError, launching: planningLaunching } = planningLaunch
const analysisLaunch = useAgentChatLaunch(pid, tid, 'analysis')
const taskDone = computed(() => task.value?.status === 'done')
const workClosed = computed(() => taskDone.value || !!task.value?.closed_at)
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
// Authors of the architecture and QA documents: one role, the kind of document is in the session's metadata.
const materialTypes = ['architecture', 'qa'] as const
const materialChats = (type: MaterialType) => taskChats('material-author').filter(s => s.metadata?.material_type === type)
const selectedMaterialChat = ref<Record<MaterialType, string | null | undefined>>({ architecture: undefined, qa: undefined })
const shownMaterialChat = (type: MaterialType) => shown(materialChats(type), selectedMaterialChat.value[type])
const materialLaunch = { architecture: useAgentChatLaunch(pid, tid, 'architecture'), qa: useAgentChatLaunch(pid, tid, 'qa') }
const materialAttention = ref<Record<MaterialType, number>>({ architecture: 0, qa: 0 })
// Documents written by hand right now: their stages show as in work before the first save.
const materialEditing = ref<Record<MaterialType, boolean>>({ architecture: false, qa: false })
const drafting = computed(() => [...(editingPlan.value ? ['plan'] : []), ...materialTypes.filter(t => materialEditing.value[t])])
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
  if (!(await appStore.confirm(`Удалить чат «${name}»? Переписка с агентом будет удалена, агент остановлен.`, { confirmLabel: "Удалить", danger: true }))) return
  try {
    await chatStore.remove(id)
    if (selectedAnalysisChat.value === id) selectedAnalysisChat.value = undefined
    if (selectedPlanningChat.value === id) selectedPlanningChat.value = undefined
    for (const type of materialTypes) if (selectedMaterialChat.value[type] === id) selectedMaterialChat.value[type] = undefined
  } catch (e) { appStore.toast(String(e), 'error') }
}
let analysisLoadVersion = 0
async function loadAnalysis(actor?: string) {
  if (!pid.value || !tid.value) return
  const version = ++analysisLoadVersion
  try {
    const sections = await tasksEndpoints.getProjectsByProjectIdTasksByTaskIdAnalysis({ params: { projectId: pid.value, taskId: tid.value } })
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
  openLabel: 'Открыть анализ',
  missingLabel: 'Раздел или файл не найден',
  exists: target => !!resolveDocumentTarget(target, analysisSections.value, materials.value),
  open: async target => {
    const resolved = resolveDocumentTarget(target, analysisSections.value, materials.value)
    if (!resolved) return
    if (resolved.type === 'analysis') { await openAnalysis(target); return }
    openedMaterial.value = null
    activeTab.value = resolved.type
    await nextTick()
    openedMaterial.value = { type: resolved.type, identifier: resolved.identifier ?? '' }
  },
})
async function launchAnalysis(request: NewChatRequest) {
  if (taskDone.value) return
  const result = await analysisLaunch.launch(request)
  if (!result) return
  chatInitials.value[result.session_id] = result.content
  await chatStore.load(result.session_id).catch(() => {}) // so the new tab is there right away
  selectedAnalysisChat.value = result.session_id
}
async function launchMaterial(type: MaterialType, request: NewChatRequest) {
  if (taskDone.value) return
  const result = await materialLaunch[type].launch(request)
  if (!result) return
  chatInitials.value[result.session_id] = result.content
  await chatStore.load(result.session_id).catch(() => {}) // so the new tab is there right away
  selectedMaterialChat.value[type] = result.session_id
}

// ——— Architecture, QA and the stage marks ———
const materials = ref<Record<MaterialType, Material | null>>({ architecture: null, qa: null })
const openedMaterial = ref<{ type: MaterialType; identifier: string } | null>(null)
const stages = ref<StageSummary[]>([])
async function loadMaterial(type: MaterialType) {
  if (!pid.value || !tid.value) return
  try { materials.value[type] = await preparationApi.material(pid.value, tid.value, type) } catch (e) { appStore.toast(String(e), 'error') }
}
async function loadStages() {
  if (!pid.value || !tid.value) return
  try { stages.value = await preparationApi.stages(pid.value, tid.value) } catch { /* the strip falls back to plain stage order */ }
}
async function markStage(stage: PreparationStage, status: 'ready' | 'skipped') {
  if (!pid.value || !tid.value) return false
  try { stages.value = await preparationApi.mark(pid.value, tid.value, stage, status); return true }
  catch (e) { appStore.toast(String(e).replace(/^Error:\s*/, ''), 'error'); return false }
}
const isStage = (tab: string): tab is PreparationStage => ['analysis', 'architecture', 'qa', 'plan'].includes(tab)
/** «Завершить этап»: the developer's mark; an agent never sets it. «План» also stops the planners, as «Утвердить план».
 *  Marking never switches the tab: the developer goes on to the next stage themselves. */
async function completeStage(tab: string) {
  if (!isStage(tab)) return
  if (tab === 'plan') { await approvePlan(); return }
  await markStage(tab, 'ready')
}
async function skipStage(tab: string) {
  if (!isStage(tab)) return
  const draft = stages.value.find(s => s.stage === tab)?.status === 'draft'
  if (draft && !(await appStore.confirm('Пропустить этап? Набросок сохранится, но основанием для следующих этапов не будет.', { confirmLabel: 'Пропустить', danger: false }))) return
  await markStage(tab, 'skipped')
}
// A saved plan with no text counts as no plan: execution stays unavailable.
const hasPlan = computed(() => !!plan.value?.content.trim())
const execDone = computed(() => !!plan.value?.steps.length && plan.value.steps.every(s => s.done))
/** The tab of the stage the work is on, as the stage strip marks it: during preparation the latest one worked on. */
function currentStageTab(): Tab {
  if (!task.value) return 'analysis'
  const order = workStagesOf(task.value), index = workStageIndex(task.value, entry.value?.state ?? null, hasPlan.value, stages.value)
  const tab = order[Math.min(index, order.length - 1)].tab as Tab
  return tabs.value.some(t => t.id === tab) ? tab : 'plan'
}
const queue = useTaskQueue(pid, tid)
provide(TaskQueueKey, queue)
const selectedQueueId = ref<string | null>(null)
const selectedSession = computed(() => queue.allSessions.value.find(s => s.id === selectedQueueId.value))
async function returnToQueue() {
  selectedQueueId.value = null
  if (route.query.session) {
    const query = { ...route.query }
    delete query.session
    await router.replace({ query })
  }
}
watch(selectedSession, session => { if (!session) selectedQueueId.value = null })
const selectedStage = computed(() => queue.stages.value.findIndex(st => st.sessions.some(s => s.id === selectedQueueId.value)))
const chat = (id?: string) => id ? chatStore.sessions.find(c => c.id === id) : undefined
const planAttention = ref(0)
const attentionCount = computed(() => queue.sessions.value.filter(s => sessionState(s, chat(s.sessionId)).attention).length)

interface TabItem { id: Tab; label: string; count?: number; countTitle?: string; live?: boolean }
const tabs = computed<TabItem[]>(() => {
  if (!task.value) return []
  const check: TabItem = { id: 'check', label: 'Проверка', count: entry.value?.state.counts.remarks, countTitle: 'Замечания, по которым нужно решение' }
  if (task.value.kind === 'errand') return [{ id: 'chat', label: 'Выполнение' }, check]
  return [
    { id: 'analysis', label: 'Анализ' },
    { id: 'architecture', label: 'Архитектура', count: materialAttention.value.architecture, countTitle: 'Карточки ревью архитектуры, которые ждут вашего решения или ответа автора' },
    { id: 'qa', label: 'QA', count: materialAttention.value.qa, countTitle: 'Карточки ревью QA, которые ждут вашего решения или ответа автора' },
    { id: 'plan', label: 'План', count: planAttention.value, countTitle: 'Карточки ревью плана, которые ждут вашего решения или ответа планировщика' },
    ...(taskDone.value ? [] : [{ id: 'exec' as const, label: 'Выполнение', count: attentionCount.value, countTitle: 'Шаги, которым нужен ваш ответ', live: queue.frozen.value }]),
    check,
  ]
})
function applyRouteTab() {
  const wanted = route.query.tab
  const tab = wanted === 'finish' ? 'check' : wanted // the Завершение stage moved into Проверка
  if (typeof tab === 'string' && tabs.value.some(t => t.id === tab)) activeTab.value = tab as Tab
}
watch(() => route.query.tab, applyRouteTab)
// «В чат» on a tab without a chat (queue, check): go to the work's chat — the errand's one, else the plan's.
const viewRoot = ref<HTMLElement>()
useComposerReveal(viewRoot, () => ({ projectId: task.value?.project_id ?? '', workspaceId: workspace.value?.id }), () => {
  if (task.value) activeTab.value = task.value.kind === 'errand' ? 'chat' : 'plan'
})

const menuItems = computed<MenuItem[]>(() => {
  const t = task.value
  if (!t) return []
  return [
    { label: 'Редактировать', hint: 'Номер задачи и описание', action: () => void startTitleEdit() },
    ...(t.kind === 'errand' && !t.closed_at ? [
      { label: 'Добавить план', hint: 'Поручение станет задачей, ветка сохранится', action: () => void addPlanToErrand() },
    ] : []),
    ...(t.status !== 'done' && t.kind !== 'errand' && !workspace.value ? [{ label: 'Отметить выполненной', hint: 'Без Завершения', action: () => void markDoneTask() }] : []),
    ...(t.status === 'done' ? [{ label: 'Вернуть в работу', action: () => void reopenTask() }] : []),
    { separator: true },
    { label: 'Удалить', hint: 'Удалить работу без возможности восстановления', danger: true, action: () => void deleteCurrentTask() },
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
async function closeWork() {
  if (!task.value) return
  // One question (actions.close): a plain confirmation, or a warning when uncommitted changes would be lost.
  const closed = await actions.close(task.value)
  if (closed) { appStore.toast('Работа закрыта. Открыть снова можно из списка «Готово»', 'success'); await onClosed(closed) }
}
async function onClosed(closed: Task) {
  task.value = closed; appStore.currentTask = closed
  await work.load(pid.value ? [pid.value] : [])
  goBack()
}

/** The queue starts at once: the branch is the one chosen above the queue, the review follows the task or the project's settings. */
async function startQueue() {
  const current = task.value
  if (startingWork.value || !current) return
  const failed = workspace.value?.status === 'failed'
  if (canChooseBranch.value && !failed && executionPlace.value.place === 'existing' && !executionPlace.value.branch) { appStore.toast('Выберите ветку выполнения', 'error'); return }
  startingWork.value = true
  // The first launch is the moment to ask for (browser) notification permission: it is a click.
  platform.requestNotifications?.()
  try {
    let autoReview = current.auto_review
    if (!autoReview && appStore.currentProject?.kind === 'project') autoReview = await gitApi.settings(current.project_id).then(settings => !!settings.auto_review).catch(() => false)
    const options: import('@contracts').QueueStartBody = canChooseBranch.value && !failed
      ? { ...executionPlace.value, auto_review: autoReview }
      : { base_branch: failed ? workspace.value!.base_branch : '', branch_name: failed ? workspace.value!.branch : '', auto_review: autoReview }
    // A failed preparation: the place is rebuilt on the same branch before the queue starts.
    if (failed) await workspacesApi.recreate(current.project_id, workspace.value!.id, true)
    await queue.start(options)
  } catch (cause) { appStore.toast(cause instanceof Error ? cause.message : String(cause), 'error') }
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
  for (const type of materialTypes) if (materialChats(type).some(c => c.id === chatId)) { selectedMaterialChat.value[type] = chatId; activeTab.value = type; return }
  if (planningChats.value.some(c => c.id === chatId)) { selectedPlanningChat.value = chatId; planningOpen.value = true; activeTab.value = 'plan'; return }
  const s = queue.allSessions.value.find(x => x.sessionId === chatId)
  if (s) { activeTab.value = 'exec'; selectedQueueId.value = s.id }
  else routeChatPending = true
}
watch(() => route.query.session, openChatFromRoute)
watch(() => chatStore.sessions.length, () => { if (routeChatPending) openChatFromRoute() })

const doneCount = computed(() => plan.value?.steps.filter(s => s.done).length ?? 0)
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
      void loadStages()
      break
    case 'material_updated':
      await Promise.all([loadMaterial(event.materialType), loadStages()])
      break
    case 'stages_updated':
      stages.value = event.stages
      break
    case 'task_status':
      if (task.value) task.value = { ...task.value, status: event.status }
      break
    case 'plan_updated':
      void loadStages()
      // During planning we need the full content live; reload to get content + steps.
      if (planningOpen.value || !plan.value || !event.steps) {
        await loadPlan()
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
  task.value = await tasksEndpoints.getProjectsByProjectIdTasksByTaskId({ params: { projectId: pid.value, taskId: taskId } })
  appStore.currentTask = task.value
}

async function loadPlan() {
  if (!pid.value || !tid.value) return
  try {
    plan.value = await tasksEndpoints.getProjectsByProjectIdTasksByTaskIdPlansLatest({ params: { projectId: pid.value, taskId: tid.value } })
  } catch { plan.value = null }
}

onMounted(async () => {
  stopEvents = onServerEvent<OrchestratorEvent>(e => { void handleEvent(e) })
  void work.load(appStore.currentProject ? [appStore.currentProject.id] : [])
  await loadTask()
  restorePlanning()
  await Promise.all([loadPlan(), loadAnalysis(), loadStages(), ...materialTypes.map(loadMaterial), agentsStore.load(), queue.load()])
  if (task.value?.kind === 'errand') activeTab.value = 'chat'
  else if (queue.queue.value?.status === 'finished') activeTab.value = 'check'
  else activeTab.value = currentStageTab()
  // Open where the work is: a running queue, or a step that waits for the developer.
  if (task.value?.kind !== 'errand' && !taskDone.value && queue.sessions.value.length && (queue.frozen.value || attentionCount.value)) activeTab.value = 'exec'
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
  selectedMaterialChat.value = { architecture: snap.selectedMaterialChat?.architecture, qa: snap.selectedMaterialChat?.qa }
}

watch([planningOpen, selectedAnalysisChat, selectedPlanningChat, selectedMaterialChat], () => {
  if (!tid.value) return
  sessionStore.save(tid.value, {
    selectedAnalysisChat: selectedAnalysisChat.value,
    planningOpen: planningOpen.value,
    selectedPlanningChat: selectedPlanningChat.value,
    selectedMaterialChat: { ...selectedMaterialChat.value },
  })
}, { deep: true })

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
  activeTab.value = 'plan'
}

// Approve the plan: stop the planning agents and leave the planning view. The chats stay and can be
// continued later through "Изменить план с агентом" (the agent restarts with its conversation).
// It is the same action as «Утвердить план» in the stage bar: earlier unmarked stages become ready if they have material, skipped if empty.
async function approvePlan() {
  if (!(await markStage('plan', 'ready'))) return
  await Promise.all(planningChats.value.map(c => agentChatEndpoints.postAgentSessionsByIdByAction({ params: { id: c.id, action: "close" } }).catch(() => { /* already stopped */ })))
  planningOpen.value = false
  await loadPlan()
  appStore.toast('План утверждён', 'success')
}

// «Утвердить» in the architecture / QA view: the same as «Утвердить план» — the stage is marked ready and the authors stop; their chats stay.
async function approveMaterial(type: MaterialType) {
  if (!(await markStage(type, 'ready'))) return
  await Promise.all(materialChats(type).map(c => agentChatEndpoints.postAgentSessionsByIdByAction({ params: { id: c.id, action: "close" } }).catch(() => { /* already stopped */ })))
  appStore.toast(`${type === 'qa' ? 'QA' : 'Архитектура'} утверждена`, 'success')
}

// ——— Mark task done ———

async function markDoneTask() {
  if (!pid.value || !tid.value) return
  if (!(await appStore.confirm('Отметить задачу выполненной? Плановый файл будет удалён.', { confirmLabel: 'Отметить выполненной', danger: false }))) return
  try {
    await tasksEndpoints.postProjectsByProjectIdTasksByTaskIdDone({ params: { projectId: pid.value, taskId: tid.value } })
    appStore.toast('Задача завершена', 'success')
    await loadTask()
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function reopenTask() {
  if (!task.value) return
  if (await actions.reopen(task.value)) { appStore.toast('Работа снова открыта', 'success'); await loadTask() }
}

const deleting = computed(() => !!task.value && isRemoving(task.value.id))
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
  startPlanDraft()
}

function togglePlanEdit() {
  if (editingPlan.value) cancelPlanDraft(); else startManualEdit()
}

async function savePlan() {
  if (!pid.value || !tid.value) return
  try {
    if (plan.value) {
      plan.value = await tasksEndpoints.patchProjectsByProjectIdTasksByTaskIdPlansByPlanId({ params: { projectId: pid.value, taskId: tid.value, planId: plan.value.id }, body: { content: planContent.value } })
    } else {
      plan.value = await tasksEndpoints.postProjectsByProjectIdTasksByTaskIdPlans({ params: { projectId: pid.value, taskId: tid.value }, body: { content: planContent.value } })
    }
    await loadStages()
    cancelPlanDraft()
    appStore.toast('План сохранён', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}
</script>

<style scoped>
.task-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative; }
.task-view.deleting > :not(.deleting-note) { opacity: 0.55; pointer-events: none; }
.deleting-note { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 10; display: flex; align-items: center; gap: 8px; padding: 6px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: var(--bg2); color: var(--text); font-size: var(--fs-md); }
.deleting-spin { width: 12px; height: 12px; border: 2px solid var(--border-strong); border-top-color: var(--blue-hover); border-radius: var(--radius-round); animation: deleting-spin 0.8s linear infinite; }
@keyframes deleting-spin { to { transform: rotate(360deg); } }

.task-edit-fields { display: flex; flex-direction: column; gap: var(--sp-3); }

/* Tab bodies */
.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.exec-no-plan { font-size: var(--fs-md); color: var(--text-muted); padding: 16px 20px; }
</style>
