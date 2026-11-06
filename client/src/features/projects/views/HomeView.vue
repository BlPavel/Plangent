<template>
  <div ref="homeRoot" class="home">
    <AppEmptyState v-if="!currentProject">
      <p>Выберите проект или создайте новый</p>
    </AppEmptyState>

    <!-- The store copy: sync status and statistics arrive there over server events. -->
    <SourceView v-else-if="currentProject.kind === 'source'" :source="projectsStore.byId(currentProject.id) ?? currentProject" @edit="showProjectModal = true" @delete="deleteProject" />

    <div v-else class="project-area">
      <!-- Project / group header -->
      <div class="project-header app-drag">
        <div class="project-title">
          <h1><span class="title-icon">{{ isGroup ? '🗂️' : '📁' }}</span>{{ currentProject.name }}</h1>
          <span v-if="isGroup" class="repo-path">
            {{ members.length ? `Проекты: ${members.map(m => m.name).join(', ')}` : 'В группе пока нет проектов — добавьте их на вкладке «Проекты»' }}
          </span>
          <span v-else class="repo-path">
            <AppButton v-if="group" variant="link" size="xs" class="app-no-drag" title="Открыть группу" @click="appStore.currentProject = group">🗂️ {{ group.name }} ›</AppButton>
            <code class="project-key">@{{ currentProject.key }}</code> {{ currentProject.repo_path }}
          </span>
        </div>
        <div class="project-header-actions app-no-drag">
          <AppButton variant="ghost" size="sm" :pressed="activeTab === 'settings'" :title="isGroup ? 'Настройки группы' : 'Настройки проекта'" @click="toggleSettings">Настройки</AppButton>
        </div>
      </div>

      <!-- Tab bar: the work places; the settings open from the header. -->
      <div class="tab-bar">
        <AppTabs bare :model-value="activeTab" :items="tabs.map(t => ({ value: t.id, label: t.label, count: t.count || undefined, title: t.countTitle }))" @update:model-value="activeTab = $event as HomeTab" />
      </div>

      <div v-show="activeTab === 'agents'" class="tab-content"><AgentChats :project-id="currentProject.id" :default-agent-id="projectsStore.agentFor(currentProject)" /></div>
      <div v-if="isGroup" v-show="activeTab === 'projects'" class="tab-content"><GroupProjects :group="currentProject" /></div>
      <div v-if="!isGroup" v-show="activeTab === 'tasks'" class="tab-content">
        <WorkList :project="currentProject" :members="members" :agents="agentsStore.agents" :default-agent-id="projectsStore.agentFor(currentProject)" :owner-name="ownerName" :move-menu="moveMenu" @open="openWork" @changed="loadTasks" />
      </div>

      <!-- Mounted only while open: the screen watches the project folder. -->
      <div v-if="activeTab === 'code' && !isGroup" class="tab-content"><CodeTab :project-id="currentProject.id" :task="codeTask" :default-agent-id="projectsStore.agentFor(currentProject)" @back="backToTask" /></div>
      <div v-if="activeTab === 'review' && !isGroup" class="tab-content"><BranchReviewTab :key="currentProject.id" :project-id="currentProject.id" @open-instructions="openReviewSkills" /></div>
      <div v-if="activeTab === 'settings'" class="tab-content">
        <ProjectSettings :key="currentProject.id" :project="currentProject" :requested="settingsRequest" @delete="deleteProject" />
      </div>
    </div>

    <DeleteGroupModal v-if="isGroup && currentProject && showDeleteGroup" v-model="showDeleteGroup" :group="currentProject" @deleted="afterDelete" />

    <ProjectFormModal
      v-if="currentProject?.kind === 'source'"
      v-model="showProjectModal"
      kind="source"
      :project="currentProject"
      @saved="p => appStore.currentProject = p"
    />
  </div>
</template>

<script lang="ts">
type HomeTab = 'agents' | 'projects' | 'tasks' | 'code' | 'review' | 'settings'
// Module-level so it survives HomeView being unmounted while a task is open.
const lastTab: { projectId: string | null; tab: HomeTab } = { projectId: null, tab: 'tasks' }
</script>

<script setup lang="ts">
import { tasksEndpoints } from '@features/tasks'
import { AgentChats, useComposerReveal } from '@features/agent-chat'
import { CodeTab, useCodeAttentionStore } from '@features/code'
import { BranchReviewTab } from '@features/branch-review'
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '../stores/projects'
import { useAgentsStore } from '@features/agents'
import type { Task } from '@contracts'
import type { MenuItem } from '@shared/ui/AppMenu.vue'
import DeleteGroupModal from '../components/DeleteGroupModal.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import AppEmptyState from '@shared/ui/AppEmptyState.vue'
import ProjectFormModal from '../components/ProjectFormModal.vue'
import ProjectSettings, { type ProjectSettingsPage } from '../components/ProjectSettings.vue'
import GroupProjects from '../components/GroupProjects.vue'
import SourceView from '../components/SourceView.vue'
import { WorkList, useWorkStore, workspacesApi } from '@features/tasks'
import { onServerEvent } from '@core/api/events'
import { onUnmounted } from 'vue'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

const currentProject = computed(() => appStore.currentProject)
const isGroup = computed(() => currentProject.value?.kind === 'group')
const group = computed(() => projectsStore.byId(currentProject.value?.group_id))
const members = computed(() => isGroup.value ? projectsStore.members(currentProject.value!.id) : [])
const tasks = ref<Task[]>([])

// Groups start on their projects; returning to the same entity restores an available tab.
const defaultTab = (): HomeTab => isGroup.value ? 'projects' : 'tasks'
const groupTabs: HomeTab[] = ['projects', 'agents', 'settings']
const restoredTab = lastTab.projectId === currentProject.value?.id ? lastTab.tab : defaultTab()
const activeTab = ref<HomeTab>(isGroup.value && !groupTabs.includes(restoredTab) ? 'projects' : restoredTab)
// «Настройки» in the header opens the settings in place of the tabs' content; pressed again, it returns to the work tab.
const workTab = ref<HomeTab>(activeTab.value === 'settings' ? defaultTab() : activeTab.value)
watch(activeTab, tab => { if (tab !== 'settings') workTab.value = tab })
function toggleSettings() { activeTab.value = activeTab.value === 'settings' ? workTab.value : 'settings' }
// Deleting lives in Настройки → Основное.
const showDeleteGroup = ref(false)
watch(activeTab, tab => { if (currentProject.value) Object.assign(lastTab, { projectId: currentProject.value.id, tab }) }, { immediate: true })
// «В чат» from the code panel on a tab without a chat: the project's «Чат» tab (a new message field when nothing was started).
const homeRoot = ref<HTMLElement>()
useComposerReveal(homeRoot, () => ({ projectId: currentProject.value?.id ?? '' }), () => { activeTab.value = 'agents' })
type TabItem = { id: HomeTab; label: string; count?: number; countTitle?: string }
const tabs = computed<TabItem[]>(() => isGroup.value
  ? [{ id: 'projects', label: `Проекты · ${members.value.length}` }, { id: 'agents', label: 'Чат' }]
  : [
      { id: 'tasks', label: 'Задачи' },
      { id: 'agents', label: 'Чат' },
      { id: 'code', label: 'Код', count: codeAttentionCount.value, countTitle: 'Пункты, по которым нужно ваше решение' },
      { id: 'review', label: 'Ревью' },
    ])

// «Код» opened from a task (query set by the task's button or a notification) shows the way back to it.
const codeAttentionStore = useCodeAttentionStore()
const codeAttentionCount = computed(() => (currentProject.value ? codeAttentionStore.countFor(codeAttentionStore.forProject(currentProject.value.id)) : 0))
const codeTaskId = ref<string | null>(null)
const codeTask = computed(() => {
  const task = tasks.value.find(t => t.id === codeTaskId.value)
  return task ? { id: task.id, key: task.key } : null
})
function backToTask() {
  if (codeTask.value) void router.push('/task/' + codeTask.value.id)
}
watch(() => route.query, query => {
  if (query.tab === 'settings' && currentProject.value) {
    activeTab.value = 'settings'
    void router.replace({ path: '/' })
    return
  }
  if (query.tab !== 'code' || !currentProject.value || isGroup.value) return
  activeTab.value = 'code'
  codeTaskId.value = typeof query.task === 'string' ? query.task : null
  void router.replace({ path: '/' })
}, { immediate: true })
watch(activeTab, tab => { if (tab !== 'code') codeTaskId.value = null })
// «Скиллы ревью…» in the Ревью tab: they are written in Настройки → Ревью.
const settingsRequest = ref<{ page: ProjectSettingsPage; at: number } | null>(null)
function openReviewSkills() {
  settingsRequest.value = { page: 'review', at: Date.now() }
  activeTab.value = 'settings'
}

const showProjectModal = ref(false)

const ownerName = (projectId: string) => projectsStore.byId(projectId)?.name ?? '—'

onMounted(() => agentsStore.load())
const stopWorkEvents = onServerEvent(event => { if (event.type === 'task_updated') void loadTasks() })
onUnmounted(stopWorkEvents)

watch(() => currentProject.value?.id, () => { loadTasks() }, { immediate: true })
// «Код» and the terminal of the project always show its main folder: a work's folder is seen inside the work.
// An older «Смотреть эту ветку» choice is dropped once.
watch(() => (isGroup.value ? null : currentProject.value?.id), async id => {
  if (!id) return
  try { if (await workspacesApi.viewing(id)) await workspacesApi.view(id, null, true) } catch { /* the main folder is the default anyway */ }
}, { immediate: true })
watch(() => currentProject.value?.id, id => {
  // «Настройки» opened from a group's project list asks for its tab together with the project switch.
  showDeleteGroup.value = false
  settingsRequest.value = null
  workTab.value = defaultTab()
  activeTab.value = route.query.tab === 'settings' ? 'settings' : defaultTab()
  Object.assign(lastTab, { projectId: id ?? null, tab: activeTab.value })
})

async function loadTasks() {
  const p = currentProject.value
  if (!p || p.kind !== 'project') { tasks.value = []; return }
  tasks.value = await tasksEndpoints.listTasks({ params: { projectId: p.id } })
}

async function deleteProject() {
  const p = currentProject.value
  if (!p) return
  // A group asks what happens to its projects.
  if (p.kind === 'group') { showDeleteGroup.value = true; return }
  const message = p.kind === 'source'
      ? p.source_type === 'docs'
        ? `Удалить справочник @${p.key}? Скачанные документы будут удалены с диска; во внешнем сервисе ничего не изменится.`
        : `Удалить справочник @${p.key}? Папка на диске не изменится.`
      : `Удалить проект «${p.name}»? Все его задачи, чаты и настройки будут удалены безвозвратно.`
  const ok = await appStore.confirm(message, { confirmLabel: 'Удалить', danger: true })
  if (!ok) return
  try {
    await projectsStore.remove(p.id)
    afterDelete()
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
}
function afterDelete() {
  appStore.currentProject = projectsStore.workProjects[0] ?? projectsStore.projects[0] ?? null
  appStore.toast('Удалено', 'success')
}

// The task page works in the task's own project, also when opened from its group.
function openWork(t: Task, tab: string) {
  const owner = projectsStore.byId(t.project_id)
  if (owner && owner.id !== currentProject.value?.id) appStore.currentProject = owner
  appStore.currentTask = t
  router.push({ path: `/task/${t.id}`, query: { tab } })
}

/** Where a task can move: a group's task into one of its projects, a project's task up into its group. */
function moveTargets(t: Task) {
  const owner = projectsStore.byId(t.project_id)
  if (!owner) return []
  if (owner.kind === 'group') return projectsStore.members(owner.id)
  const g = projectsStore.byId(owner.group_id)
  return g ? [g] : []
}
function moveMenu(t: Task): MenuItem[] {
  return [{ heading: 'Переместить задачу' }, ...moveTargets(t).map(target => ({
    label: `${target.kind === 'group' ? '🗂️' : '📁'} ${target.kind === 'group' ? `В группу «${target.name}»` : target.name}`,
    action: () => void moveTask(t, target.id),
  }))]
}
async function moveTask(t: Task, targetId: string) {
  try {
    const moved = await tasksEndpoints.moveTask({ params: { projectId: t.project_id, taskId: t.id }, body: { project_id: targetId } })
    if (isGroup.value) tasks.value = tasks.value.map(x => x.id === t.id ? moved : x)
    else tasks.value = tasks.value.filter(x => x.id !== t.id)
    void useWorkStore().load()
    appStore.toast(`«${t.key}» перенесена в «${projectsStore.byId(targetId)?.name}»`, 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

</script>

<style scoped>
.home { height: 100%; display: flex; flex-direction: column; }
/* Align the header and the first tab's hover edge with the Chats heading. */
.project-area { --page-inset: calc(var(--sp-2) + 10px); display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.project-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: calc(var(--titlebar-h) + var(--sp-3)) var(--page-inset) var(--sp-3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.project-title { min-width: 0; }
.project-header-actions { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; align-self: center; }
.title-icon { margin-right: 8px; }
.project-key { margin-right: 6px; color: var(--text); }
.project-header h1 { font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.01em; margin-bottom: 2px; }
.repo-path {
  display: block;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The first tab starts on the page's left edge, like the title and the content. */
.tab-bar { padding-left: var(--page-inset); border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }

.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
