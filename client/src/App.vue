<template>
  <div id="layout">
    <aside class="sidebar">
      <div class="logo app-drag">⚡ Plangent</div>

      <button class="btn btn-ghost new-project-btn" @click="showAddProject = true">
        <span class="btn-plus">+</span> Новый проект
      </button>

      <div class="nav-label">Проекты</div>
      <div class="project-list">
        <div
          v-for="p in projectsStore.projects"
          :key="p.id"
          class="project-item app-no-drag"
          :class="{ active: !isSettingsRoute && appStore.currentProject?.id === p.id }"
          @click="selectProject(p)"
        >
          <span class="project-name">{{ p.name }}</span>
          <span
            v-if="blockedQueues.forProject(p.id).length"
            class="project-blocked"
            :title="blockedQueues.forProject(p.id).map(b => `${b.taskKey}: ${b.reason}`).join('\n')"
          >{{ blockedQueues.forProject(p.id).length }}</span>
        </div>
        <div v-if="!projectsStore.projects.length" class="project-empty">
          Пока нет проектов
        </div>
      </div>

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

    <!-- Add project modal -->
    <AppModal v-model="showAddProject" title="Новый проект" confirm-label="Создать" @confirm="addProject">
      <FormField v-model="newProject.name" label="Название" placeholder="My Project" />
      <div class="form-field">
        <label>Путь к репозиторию</label>
        <FolderPicker v-model="newProject.repo_path" />
      </div>
      <FormField v-model="newProject.default_agent_id" label="Агент по умолчанию" type="select">
        <option value="">— выбрать —</option>
        <option v-for="a in agentsStore.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </FormField>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '@features/agent-chat'
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import { useAgentsStore } from '@features/agents'
import type { Project } from '@core/models'
import { api } from '@core/api'
import { platform } from '@core/platform'
import { startQueueNotifications, useBlockedQueuesStore } from '@features/tasks'
import { UpdateStatus } from '@features/updates'
import AppToast from '@shared/ui/AppToast.vue'
import AppConfirm from '@shared/ui/AppConfirm.vue'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'

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

const showAddProject = ref(false)
const newProject = ref({ name: '', repo_path: '', default_agent_id: '' })
const appVersion = ref('')

onMounted(async () => {
  await Promise.all([projectsStore.load(), agentsStore.load()])
  if (projectsStore.projects.length && !appStore.currentProject) {
    selectProject(projectsStore.projects[0])
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

async function addProject() {
  const { name, repo_path, default_agent_id } = newProject.value
  if (!name || !repo_path) return
  try {
    const p = await projectsStore.create({
      name,
      repo_path,
      default_agent_id: default_agent_id || null,
      config: {},
    })
    selectProject(p)
    appStore.toast('Проект создан', 'success')
    showAddProject.value = false
    newProject.value = { name: '', repo_path: '', default_agent_id: '' }
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
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

.new-project-btn {
  width: 100%;
  justify-content: center;
  margin-bottom: var(--sp-4);
}
.btn-plus { font-size: 15px; line-height: 1; margin-top: -1px; }

.nav-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  padding: 0 6px var(--sp-2);
}

.project-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.project-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  transition: background 0.12s, color 0.12s;
}
.project-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Tasks whose running queue is stuck until the developer answers; details in the tooltip. */
.project-blocked {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--warning);
  color: #0d1117;
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.project-item:hover { background: var(--bg3); color: var(--text); }
.project-item.active { background: var(--bg3); color: var(--text); box-shadow: inset 2px 0 0 var(--blue); }
.project-empty { padding: 8px 10px; font-size: 12px; color: var(--text-faint); }

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
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
