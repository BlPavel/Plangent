<template>
  <div id="layout">
    <nav v-if="sidebarCollapsed" class="sidebar-rail" aria-label="Панель проектов свёрнута">
      <AppButton class="app-no-drag" variant="subtle" size="sm" icon title="Развернуть панель проектов" aria-label="Развернуть панель проектов" @click="sidebarCollapsed = false">
        <IconSidebar />
      </AppButton>
      <div ref="newMenuRail" class="rail-new app-no-drag">
        <AppButton variant="subtle" size="sm" icon title="Новый" aria-label="Новый" aria-haspopup="menu" :aria-expanded="newMenuOpen" @click="newMenuOpen = !newMenuOpen">
          <span class="rail-plus">+</span>
        </AppButton>
      </div>
      <RouterLink to="/settings" class="rail-settings app-no-drag" :class="{ active: isSettingsRoute }" title="Настройки" aria-label="Настройки">⚙</RouterLink>
    </nav>
    <aside v-else class="sidebar">
      <div class="logo-row">
        <div class="logo app-drag">⚡ Plangent</div>
        <AppButton class="app-no-drag" variant="subtle" size="sm" icon title="Свернуть панель проектов" aria-label="Свернуть панель проектов" @click="sidebarCollapsed = true">
          <IconSidebar />
        </AppButton>
      </div>

      <div ref="newMenu" class="new-menu app-no-drag">
        <AppButton block :aria-expanded="newMenuOpen" aria-haspopup="menu" @click="newMenuOpen = !newMenuOpen">
          <span class="btn-plus">+</span> Новый
        </AppButton>
      </div>

      <ProjectTree
        :current-id="isSettingsRoute ? null : appStore.currentProject?.id ?? null"
        :blocked="projectAttention"
        @select="selectProject"
      />

      <RouterLink to="/settings" class="sidebar-link app-no-drag" :class="{ active: $route.path === '/settings' }">
        <span class="sidebar-link-icon">⚙</span> Настройки
      </RouterLink>

      <UpdateStatus :version="appVersion" />
    </aside>

    <AppPopover v-model="newMenuOpen" :anchor="newMenuAnchor" :match-anchor="!sidebarCollapsed" role="menu" focus-on-open>
      <AppButton v-for="o in NEW_OPTIONS" :key="o.kind" variant="subtle" block multiline start role="menuitem" @click="openCreate(o.kind)">
        <span class="new-option"><span class="new-option-icon" aria-hidden="true">{{ o.icon }}</span><span class="new-option-text"><strong>{{ o.label }}</strong><small>{{ o.hint }}</small></span></span>
      </AppButton>
    </AppPopover>

    <main class="content">
      <div class="content-body">
        <div class="content-view"><RouterView :key="route.params.id ? String(route.params.id) : route.path" /></div>
        <CodeSidePanel v-if="codeShown && terminalPlace" :place="terminalPlace" @close="codeOpen = false" @to-chat="toChat" @open-in-code="openInCode" />
      </div>
      <TerminalDock :context="terminalPlace" :place-label="placeLabel">
        <template #buttons><CodeSideToggle v-model:open="codeOpen" :available="codeAvailable" /></template>
      </TerminalDock>
    </main>

    <ToastHost />
    <ConfirmHost />

    <ProjectFormModal v-model="showCreate" :kind="createKind" :group-id="createGroupId" @saved="selectProject" />
  </div>
</template>

<script setup lang="ts">
import { AppButton, AppPopover } from '@shared/ui'
import { IconSidebar } from '@shared/ui/icons'
import { settingsEndpoints } from '@features/settings'

import { useChatStore, useComposerTargetsStore, type MentionDrag } from '@features/agent-chat'
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { ProjectFormModal, ProjectTree, useProjectsStore } from '@features/projects'
import { useAgentsStore } from '@features/agents'
import type { Project, ProjectKind } from '@contracts'
import { platform } from '@core/platform'
import { startQueueNotifications, useBlockedQueuesStore, useWorkStore } from '@features/tasks'
import { TerminalDock } from '@features/terminal'
import { CodeSidePanel, CodeSideToggle, startCodeNotifications, requestCodeOpen, codeTarget, type OpenInCode, useCodeAttentionStore, useSidePanelStore } from '@features/code'
import { UpdateStatus } from '@features/updates'
import ToastHost from './ToastHost.vue'
import ConfirmHost from './ConfirmHost.vue'

const chatStore = useChatStore()
void chatStore.connect()
const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

startQueueNotifications(router)
startCodeNotifications(router)
const codeAttention = useCodeAttentionStore()
const blockedQueues = useBlockedQueuesStore()
// Decisions are displayed at their origin: Code remarks in Code, task remarks in their work.
watch(() => projectsStore.projects, list => codeAttention.start(list.filter(p => p.kind === 'project').map(p => p.id)), { immediate: true })
blockedQueues.start()
const projectAttention = (projectId: string) => [
  ...blockedQueues.forProject(projectId),
  ...chatStore.sessions.filter(session => session.project_id === projectId && session.role === 'code-fixer' && session.status === 'waiting')
    .map(session => ({ taskKey: 'Код', reason: session.reason || 'Агент ждёт разрешения' })),
  ...codeAttention.forCode(projectId).flatMap(review => review.items.map(item => ({
    taskKey: 'Код', reason: `${item.file ?? 'Общее замечание'}: ${item.text.replace(/\s+/g, ' ').trim()}`,
  }))),
]
// A clicked notification opens its task, switching to the task's project first.
platform.onNotificationClick?.(async target => {
  const projectId = new URL(target, location.origin).searchParams.get('project')
  if (projectId && appStore.currentProject?.id !== projectId) {
    if (!projectsStore.projects.length) await projectsStore.load()
    const project = projectsStore.projects.find(p => p.id === projectId)
    if (project) appStore.currentProject = project
  }
  void router.push(target)
})

// The projects panel folds into a narrow rail; the choice is remembered.
const sidebarCollapsed = ref(localStorage.getItem('sidebar.collapsed') === '1')
watch(sidebarCollapsed, value => localStorage.setItem('sidebar.collapsed', value ? '1' : '0'))

const isSettingsRoute = computed(() => route.path === '/settings')

// The bottom terminal works where you are: inside a work — in its own folder, elsewhere — in the project's main folder.
const work = useWorkStore()
const workName = (t: { kind: string; title?: string; external_key?: string | null; key: string }) => (t.kind === 'errand' ? '⚡ ' : '') + [t.external_key, t.title].filter(Boolean).join(' ') || t.key
interface WorkPlace { projectId: string; workspaceId: string | null; label: string; blocked?: string }
const terminalPlace = computed<WorkPlace | null>(() => {
  const task = appStore.currentTask
  if (route.path.startsWith('/task/') && task && task.id === String(route.params.id)) {
    const workspace = work.entries.find(e => e.task.id === task.id)?.workspace
    if (workspace && workspace.status !== 'ready') return { projectId: task.project_id, workspaceId: null, label: workName(task), blocked: 'Рабочее место этой работы ещё не готово — терминал откроется в нём, когда оно будет готово.' }
    return { projectId: task.project_id, workspaceId: workspace?.id ?? null, label: workName(task) + (workspace ? ' · ⎇ ' + workspace.branch + (workspace.port_slot ? ' · порты №' + workspace.port_slot : '') : ' · основная папка') }
  }
  const project = appStore.currentProject
  // Groups and settings have no folder of their own, so there is no terminal there.
  return project && project.kind !== 'source' && project.kind !== 'group' && !isSettingsRoute.value ? { projectId: project.id, workspaceId: null, label: project.name + ' · основная папка' } : null
})
// Side code shares the terminal's place; it is unavailable where the screen already shows code, in groups and without a project.
// A work's folder which is not ready yet is shown as the panel's hint, as in the terminal.
const codeAvailable = computed(() => !!terminalPlace.value && appStore.currentProject?.kind === 'project'
  && appStore.codeScreenCount === 0 && !isSettingsRoute.value)
// Openness is remembered; going to a screen without side code keeps it, so coming back finds the panel as it was.
const codeOpen = ref(localStorage.getItem('code.side.open') === '1')
watch(codeOpen, value => localStorage.setItem('code.side.open', value ? '1' : '0'))
const codeShown = computed(() => codeOpen.value && codeAvailable.value)

// What the panel remembers about a work's folder or a project goes away with them.
const sidePanel = useSidePanelStore()
let knownWorkspaces = new Set<string>()
watch(() => work.entries, entries => {
  const now = new Set(entries.flatMap(e => (e.workspace ? [e.workspace.id] : [])))
  for (const id of knownWorkspaces) if (!now.has(id)) sidePanel.forgetWorkspace(id)
  knownWorkspaces = now
}, { immediate: true })
let knownProjects = new Set<string>()
watch(() => projectsStore.projects, list => {
  const now = new Set(list.map(p => p.id))
  for (const id of knownProjects) if (!now.has(id)) sidePanel.forgetProject(id)
  knownProjects = now
}, { immediate: true })
// «В чат»: the mention goes to the field typed in last, or the screen shows one.
const composerTargets = useComposerTargetsStore()
async function toChat(mention: MentionDrag) {
  if (!(await composerTargets.insertMention(mention))) appStore.toast('На этом экране нет поля сообщения для упоминания', 'info')
}
// «Открыть в Коде»: the work's «Проверка» or the project's «Код», on the same file, line and comparison.
function openInCode(target: OpenInCode) {
  const place = terminalPlace.value
  if (!place) return
  requestCodeOpen(place.projectId, place.workspaceId, target)
  const task = appStore.currentTask
  if (route.path.startsWith('/task/') && task && task.project_id === place.projectId) void router.push({ path: '/task/' + task.id, query: { tab: 'check' } })
  else void router.push(codeTarget(place.projectId))
}
function placeLabel(_projectId: string, workspaceId: string | null) {
  if (!workspaceId) return 'основная папка'
  const entry = work.entries.find(e => e.workspace?.id === workspaceId)
  return entry ? workName(entry.task) : 'папка работы'
}

const NEW_OPTIONS: { kind: ProjectKind; icon: string; label: string; hint: string }[] = [
  { kind: 'project', icon: '📁', label: 'Проект', hint: 'Репозиторий, в котором работают агенты' },
  { kind: 'group', icon: '🗂️', label: 'Группа', hint: 'Несколько проектов и общие задачи' },
  { kind: 'source', icon: '📘', label: 'Справочник', hint: 'Папка или документация, которую читает агент' },
]
const newMenu = ref<HTMLElement>()
const newMenuRail = ref<HTMLElement>()
// «Новый» lives in the full panel or, when it is folded, in the rail.
const newMenuAnchor = computed(() => (sidebarCollapsed.value ? newMenuRail.value : newMenu.value))
const newMenuOpen = ref(false)
const showCreate = ref(false)
const createKind = ref<ProjectKind>('project')
// A project created while a group is open goes into that group.
const createGroupId = ref<string | null>(null)
const appVersion = ref('')

function openCreate(kind: ProjectKind) {
  newMenuOpen.value = false
  createKind.value = kind
  const current = appStore.currentProject
  createGroupId.value = current?.kind === 'group' ? current.id : current?.kind === 'project' ? current.group_id : null
  showCreate.value = true
}

onMounted(async () => {
  await Promise.all([projectsStore.load(), agentsStore.load()])
  appStore.restoreProject(projectsStore.projects)
  try {
    const health = await settingsEndpoints.getHealth({ params: {  } })
    appVersion.value = health.version
  } catch { /* version display is best-effort */ }
})

function selectProject(p: Project) {
  appStore.currentProject = p
  if (router.currentRoute.value.path !== '/') router.push('/')
}
</script>

<style scoped>
#layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  width: 236px;
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  /* Extra top padding clears the macOS traffic lights (hiddenInset titlebar) */
  padding: calc(var(--titlebar-h) + var(--sp-2)) var(--sp-3) var(--sp-3);
  flex-shrink: 0;
}
.logo-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding-bottom: var(--sp-4); }
.logo {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
  padding: 0 6px;
}
.sidebar-rail {
  width: 44px;
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Same top clearance as the full panel, so the macOS traffic lights stay free */
  padding: calc(var(--titlebar-h) + var(--sp-2)) 0 var(--sp-3);
  flex-shrink: 0;
}
.sidebar-rail > * + * { margin-top: var(--sp-2); }
.rail-new { display: flex; }
.rail-plus { font-size: var(--fs-lg); line-height: var(--lh-tight); }
.rail-settings {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-base);
  color: var(--text-muted);
  text-decoration: none;
}
.rail-settings:hover { background: var(--bg3); color: var(--text); }
.rail-settings.active { background: var(--bg3); color: var(--text); }

.new-menu { position: relative; margin-bottom: var(--sp-3); }
.new-option { display: flex; align-items: flex-start; gap: var(--sp-3); padding-block: var(--sp-1); }
.new-option-icon { width: 20px; flex-shrink: 0; text-align: center; line-height: var(--lh-normal); }
.new-option-text { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-1); min-width: 0; }
.btn-plus { font-size: var(--fs-lg); line-height: var(--lh-tight); margin-top: -1px; }

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--sp-2);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  text-decoration: none;
  transition: background var(--motion-fast), color var(--motion-fast);
}
.sidebar-link-icon { font-size: var(--fs-base); }
.sidebar-link:hover { background: var(--bg3); color: var(--text); }
.sidebar-link.active { background: var(--bg3); color: var(--text); box-shadow: inset 2px 0 0 var(--blue); }

.content { flex: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
.content-body { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.content-view { flex: 1; min-width: 360px; min-height: 0; overflow: hidden; }
</style>
