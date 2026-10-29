<template>
  <div class="home">
    <div v-if="!currentProject" class="empty-state">
      <p>Выберите проект или создайте новый</p>
    </div>

    <!-- The store copy: sync status and statistics arrive there over server events. -->
    <SourceView v-else-if="currentProject.kind === 'source'" :source="projectsStore.byId(currentProject.id) ?? currentProject" @edit="showProjectModal = true" @delete="deleteProject" />

    <div v-else class="project-area">
      <!-- Project / group header -->
      <div class="project-header app-drag">
        <div class="project-title">
          <h1><span class="title-icon">{{ isGroup ? '🗂' : '📁' }}</span>{{ currentProject.name }}</h1>
          <span v-if="isGroup" class="repo-path">
            {{ members.length ? `Проекты: ${members.map(m => m.name).join(', ')}` : 'В группе пока нет проектов — добавьте их на вкладке «Проекты»' }}
          </span>
          <span v-else class="repo-path">
            <button v-if="group" class="crumb app-no-drag" title="Открыть группу" @click="appStore.currentProject = group">🗂 {{ group.name }} ›</button>
            <code class="project-key">@{{ currentProject.key }}</code> {{ currentProject.repo_path }}
          </span>
        </div>
        <div class="project-header-actions">
          <AppButton variant="danger-ghost" size="sm" @click="deleteProject">Удалить</AppButton>
        </div>
      </div>

      <ViewingBar v-if="!isGroup" :workspace="viewing.workspace" :project-id="currentProject.id" @terminal="activeTab = 'terminal'" />

      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab-btn"
          :class="{ active: activeTab === t.id, disabled: t.disabled }"
          :disabled="t.disabled"
          @click="activeTab = t.id"
        >{{ t.label }}<span v-if="t.count" class="tab-count warn" :title="t.countTitle">{{ t.count }}</span></button>
      </div>

      <div v-show="activeTab === 'agents'" class="tab-content"><AgentChats :project-id="currentProject.id" :default-agent-id="projectsStore.agentFor(currentProject)" /></div>
      <div v-if="isGroup" v-show="activeTab === 'projects'" class="tab-content"><GroupProjects :group="currentProject" /></div>
      <div v-show="activeTab === 'terminal'" class="tab-content"><TerminalsView :project-id="currentProject.id" :workspace-id="viewing.workspace?.id ?? null" :visible="activeTab === 'terminal'" /></div>
      <div v-show="activeTab === 'tasks'" class="tab-content tasks-tab">
        <WorkList :project="currentProject" :members="members" :agents="agentsStore.agents" :default-agent-id="projectsStore.agentFor(currentProject)" :owner-name="ownerName" :move-menu="moveMenu" @open="openWork" @changed="loadTasks" />
      </div>

      <!-- Tab: Инструкции -->
      <!-- Mounted only while open: the screen watches the project folder. -->
      <div v-if="activeTab === 'code' && !isGroup" class="tab-content"><CodeTab :key="viewing.workspace?.id ?? 'main'" :project-id="currentProject.id" :workspace-id="viewing.workspace?.id ?? null" :task="codeTask" :default-agent-id="projectsStore.agentFor(currentProject)" @back="backToTask" /></div>
      <div v-if="activeTab === 'review'" class="tab-content"><BranchReviewTab :key="currentProject.id" :project-id="currentProject.id" :members="isGroup ? projectsStore.members(currentProject.id) : undefined" @open-instructions="openReviewSkills" /></div>
      <div v-if="activeTab === 'settings'" class="tab-content"><ProjectSettingsTab :key="currentProject.id" :project="currentProject" /></div>
      <div v-show="activeTab === 'instructions'" class="tab-content instructions-tab">
        <InstructionsWorkspace v-if="currentProject" :project-id="currentProject.id" :default-agent-id="projectsStore.agentFor(currentProject)" :requested="instructionsRequest" />
      </div>

    </div>

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
type HomeTab = 'agents' | 'projects' | 'terminal' | 'tasks' | 'code' | 'review' | 'instructions' | 'settings'
// Module-level so it survives HomeView being unmounted while a task is open.
const lastTab: { projectId: string | null; tab: HomeTab } = { projectId: null, tab: 'agents' }
</script>

<script setup lang="ts">
import { TerminalsView } from '@features/terminal'
import { AgentChats } from '@features/agent-chat'
import { CodeTab, useCodeAttentionStore } from '@features/code'
import { BranchReviewTab } from '@features/branch-review'
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '../stores/projects'
import { useAgentsStore } from '@features/agents'
import { api } from '@core/api'
import type { Task } from '@core/models'
import { type MenuItem } from '@shared/ui/AppMenu.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { InstructionsWorkspace } from '@features/library'
import ProjectFormModal from '../components/ProjectFormModal.vue'
import ViewingBar from '../components/ViewingBar.vue'
import { useViewingStore } from '../stores/viewing'
import ProjectSettingsTab from '../components/ProjectSettingsTab.vue'
import GroupProjects from '../components/GroupProjects.vue'
import SourceView from '../components/SourceView.vue'
import { WorkList, useWorkStore } from '@features/tasks'
import { onServerEvent } from '@core/api/events'
import { onUnmounted } from 'vue'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()
const viewing = useViewingStore()

const currentProject = computed(() => appStore.currentProject)
const isGroup = computed(() => currentProject.value?.kind === 'group')
const group = computed(() => projectsStore.byId(currentProject.value?.group_id))
const members = computed(() => isGroup.value ? projectsStore.members(currentProject.value!.id) : [])
const tasks = ref<Task[]>([])

// A freshly opened project starts on «Агенты»; coming back from a task restores the tab you left.
const activeTab = ref<HomeTab>(lastTab.projectId && lastTab.projectId === appStore.currentProject?.id ? lastTab.tab : 'agents')
watch(activeTab, tab => { if (currentProject.value) Object.assign(lastTab, { projectId: currentProject.value.id, tab }) }, { immediate: true })
type TabItem = { id: HomeTab; label: string; disabled: boolean; count?: number; countTitle?: string }
const tabs = computed<TabItem[]>(() => [
  ...(isGroup.value ? [{ id: 'projects' as const, label: `Проекты · ${members.value.length}`, disabled: false }] : []),
  { id: 'agents' as const, label: 'Агенты', disabled: false },
  { id: 'terminal' as const, label: 'Терминал', disabled: false },
  { id: 'tasks' as const, label: 'Задачи', disabled: false },
  ...(isGroup.value ? [] : [{ id: 'code' as const, label: 'Код', disabled: false, count: codeAttentionCount.value, countTitle: 'Пункты, по которым нужно ваше решение' }]),
  { id: 'review' as const, label: 'Ревью', disabled: false },
  { id: 'instructions' as const, label: 'Инструкции', disabled: false },
  { id: 'settings' as const, label: 'Настройки', disabled: false },
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
// «Скиллы ревью…» in the Ревью tab: they are written in Инструкции → Ревью.
const instructionsRequest = ref<{ view: 'review'; at: number } | null>(null)
function openReviewSkills() {
  instructionsRequest.value = { view: 'review', at: Date.now() }
  activeTab.value = 'instructions'
}

const showProjectModal = ref(false)

const ownerName = (projectId: string) => projectsStore.byId(projectId)?.name ?? '—'

onMounted(() => agentsStore.load())
const stopWorkEvents = onServerEvent(event => { if (event.type === 'task_updated') void loadTasks() })
onUnmounted(stopWorkEvents)

watch(() => currentProject.value?.id, () => { loadTasks() }, { immediate: true })
watch(() => (isGroup.value ? null : currentProject.value?.id), id => { void viewing.load(id) }, { immediate: true })
watch(() => currentProject.value?.id, id => {
  // «Настройки» opened from a group's project list asks for its tab together with the project switch.
  activeTab.value = route.query.tab === 'settings' ? 'settings' : 'agents'
  Object.assign(lastTab, { projectId: id ?? null, tab: activeTab.value })
})

async function loadTasks() {
  const p = currentProject.value
  if (!p || p.kind === 'source') { tasks.value = []; return }
  tasks.value = await api.get<Task[]>(`/projects/${p.id}/tasks${p.kind === 'group' ? '?members=1' : ''}`)
}

async function deleteProject() {
  const p = currentProject.value
  if (!p) return
  const message = p.kind === 'group'
    ? `Удалить группу «${p.name}»? Проекты останутся и выйдут из группы, а задачи и чаты самой группы будут удалены безвозвратно.`
    : p.kind === 'source'
      ? p.source_type === 'docs'
        ? `Удалить справочник @${p.key}? Скачанные документы будут удалены с диска; во внешнем сервисе ничего не изменится.`
        : `Удалить справочник @${p.key}? Папка на диске не изменится.`
      : `Удалить проект «${p.name}»? Все его задачи, чаты и настройки будут удалены безвозвратно.`
  const ok = await appStore.confirm(message, { confirmLabel: 'Удалить', danger: true })
  if (!ok) return
  try {
    await projectsStore.remove(p.id)
    appStore.currentProject = projectsStore.workProjects[0] ?? projectsStore.projects[0] ?? null
    appStore.toast('Удалено', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  }
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
    label: `${target.kind === 'group' ? '🗂' : '📁'} ${target.kind === 'group' ? `В группу «${target.name}»` : target.name}`,
    action: () => void moveTask(t, target.id),
  }))]
}
async function moveTask(t: Task, targetId: string) {
  try {
    const moved = await api.post<Task>(`/projects/${t.project_id}/tasks/${t.id}/move`, { project_id: targetId })
    if (isGroup.value) tasks.value = tasks.value.map(x => x.id === t.id ? moved : x)
    else tasks.value = tasks.value.filter(x => x.id !== t.id)
    void useWorkStore().load()
    appStore.toast(`«${t.key}» перенесена в «${projectsStore.byId(targetId)?.name}»`, 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
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
.project-header-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.title-icon { margin-right: 8px; }
.crumb { background: none; border: none; padding: 0; margin-right: 6px; color: var(--text-muted); font: inherit; cursor: pointer; }
.crumb:hover { color: var(--blue-hover); }
.project-key { margin-right: 6px; color: var(--text); }
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
.tab-count { min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.tab-count.warn { background: var(--warning); color: #0d1117; }
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
  display: flex;
  align-items: center;
  gap: 8px;
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
.task-owner { flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: 11px; color: var(--text-muted); }
.task-owner.own { color: var(--blue-hover); border-color: var(--blue-soft); }
.task-menu { opacity: 0; transition: opacity 0.12s; }
.task-card:hover .task-menu, .task-menu:has(.menu.open) { opacity: 1; }
.task-filter { width: 190px; }
.task-search { width: 200px; height: var(--size-md); padding: 0 10px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 13px; }
.task-search:focus { outline: none; border-color: var(--blue); }

.task-act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.task-act svg { width: 16px; height: 16px; }
.task-card:hover .task-act { opacity: 0.75; }
.task-act:hover { opacity: 1; }
.task-del { color: var(--danger-hover); }
.task-del:hover { background: var(--danger-soft); }
.task-done { color: var(--accent-hover); }
.task-done:hover { background: var(--accent-soft); }
.task-reopen { color: var(--blue-hover); }
.task-reopen:hover { background: var(--blue-soft); }
.task-act + .task-del { margin-left: -8px; }

.instructions-tab { overflow: hidden; }

.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
