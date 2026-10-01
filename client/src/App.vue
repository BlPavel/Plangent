<template>
  <div id="layout">
    <aside class="sidebar">
      <div class="logo app-drag">⚡ Plangent</div>

      <div ref="newMenu" class="new-menu app-no-drag">
        <button class="btn btn-ghost new-project-btn" @click="newMenuOpen = !newMenuOpen">
          <span class="btn-plus">+</span> Новый
        </button>
        <div v-if="newMenuOpen" class="new-menu-list">
          <button v-for="o in NEW_OPTIONS" :key="o.kind" type="button" class="new-menu-item" @click="openCreate(o.kind)">
            <span>{{ o.icon }}</span><span class="new-menu-text"><b>{{ o.label }}</b><small>{{ o.hint }}</small></span>
          </button>
        </div>
      </div>

      <ProjectTree
        :current-id="isSettingsRoute ? null : appStore.currentProject?.id ?? null"
        :blocked="blockedQueues.forProject"
        @select="selectProject"
        @create="openCreate"
        @regroup="regroup"
      />

      <RouterLink to="/settings" class="sidebar-link app-no-drag" :class="{ active: $route.path === '/settings' }">
        <span class="sidebar-link-icon">⚙</span> Настройки
      </RouterLink>

      <UpdateStatus :version="appVersion" />
    </aside>

    <main class="content">
      <RouterView :key="route.params.id ? String(route.params.id) : route.path" />
    </main>

    <AppToast />
    <AppConfirm />

    <ProjectFormModal v-model="showCreate" :kind="createKind" :group-id="createGroupId" @saved="selectProject" />
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '@features/agent-chat'
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { ProjectFormModal, ProjectTree, useProjectsStore } from '@features/projects'
import { useAgentsStore } from '@features/agents'
import type { Project, ProjectKind } from '@core/models'
import { api } from '@core/api'
import { platform } from '@core/platform'
import { startQueueNotifications, useBlockedQueuesStore } from '@features/tasks'
import { UpdateStatus } from '@features/updates'
import AppToast from '@shared/ui/AppToast.vue'
import AppConfirm from '@shared/ui/AppConfirm.vue'

const chatStore = useChatStore()
void chatStore.connect()
const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

startQueueNotifications()
const blockedQueues = useBlockedQueuesStore()
blockedQueues.start()
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

const isSettingsRoute = computed(() => route.path === '/settings')

const NEW_OPTIONS: { kind: ProjectKind; icon: string; label: string; hint: string }[] = [
  { kind: 'project', icon: '📁', label: 'Проект', hint: 'Репозиторий, в котором работают агенты' },
  { kind: 'group', icon: '🗂', label: 'Группа', hint: 'Несколько проектов и общие задачи' },
  { kind: 'source', icon: '📘', label: 'Справочник', hint: 'Папка только для чтения, @имя' },
]
const newMenu = ref<HTMLElement>()
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
document.addEventListener('mousedown', e => { if (!newMenu.value?.contains(e.target as Node)) newMenuOpen.value = false })

async function regroup(p: Project, groupId: string | null) {
  try {
    const updated = await projectsStore.update(p.id, { group_id: groupId })
    if (appStore.currentProject?.id === p.id) appStore.currentProject = updated
    appStore.toast(groupId ? `«${p.name}» в группе «${projectsStore.byId(groupId)?.name}»` : `«${p.name}» вне группы`, 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

onMounted(async () => {
  await Promise.all([projectsStore.load(), agentsStore.load()])
  if (projectsStore.projects.length && !appStore.currentProject) {
    selectProject(projectsStore.workProjects[0] ?? projectsStore.projects[0])
  }
  try {
    const health = await api.get<{ ok: boolean; version: string }>('/health')
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
.logo {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  padding: 0 6px var(--sp-4);
}

.new-menu { position: relative; margin-bottom: var(--sp-3); }
.new-project-btn {
  width: 100%;
  justify-content: center;
}
.btn-plus { font-size: 15px; line-height: 1; margin-top: -1px; }
.new-menu-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 60;
  padding: 4px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.new-menu-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.new-menu-item:hover { background: var(--bg3); }
.new-menu-text { display: flex; flex-direction: column; gap: 1px; }
.new-menu-text b { font-weight: 600; }
.new-menu-text small { font-size: 11px; color: var(--text-faint); }

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--sp-2);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}
.sidebar-link-icon { font-size: 14px; }
.sidebar-link:hover { background: var(--bg3); color: var(--text); }
.sidebar-link.active { background: var(--bg3); color: var(--text); box-shadow: inset 2px 0 0 var(--blue); }

.content { flex: 1; overflow: hidden; }
</style>
