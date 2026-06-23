<template>
  <div id="layout">
    <aside class="sidebar">
      <div class="logo">⚡ Plangent</div>

      <button class="btn btn-ghost new-project-btn" @click="showAddProject = true">
        + Новый проект
      </button>

      <div class="project-list">
        <div
          v-for="p in projectsStore.projects"
          :key="p.id"
          class="project-item"
          :class="{ active: appStore.currentProject?.id === p.id }"
          @click="selectProject(p)"
        >{{ p.name }}</div>
      </div>

      <RouterLink to="/settings" class="sidebar-link" :class="{ active: $route.path === '/settings' }">
        ⚙ Настройки
      </RouterLink>
    </aside>

    <main class="content">
      <RouterView />
    </main>

    <AppToast />

    <!-- Add project modal -->
    <AppModal v-model="showAddProject" title="Новый проект" @confirm="addProject">
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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import { useAgentsStore } from '@features/agents'
import type { Project } from '@core/models'
import AppToast from '@shared/ui/AppToast.vue'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'

const router = useRouter()
const appStore = useAppStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()

const showAddProject = ref(false)
const newProject = ref({ name: '', repo_path: '', default_agent_id: '' })

onMounted(async () => {
  await Promise.all([projectsStore.load(), agentsStore.load()])
  if (projectsStore.projects.length && !appStore.currentProject) {
    selectProject(projectsStore.projects[0])
  }
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
  width: 220px;
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  flex-shrink: 0;
}
.logo { font-size: 16px; font-weight: 600; padding: 8px 8px 12px; }

.new-project-btn {
  width: 100%;
  justify-content: flex-start;
  margin-bottom: 8px;
  font-size: 13px;
}

.project-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.project-item {
  padding: 6px 8px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.1s;
}
.project-item:hover, .project-item.active { background: var(--bg3); color: var(--text); }

.sidebar-link {
  display: block;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-muted);
  text-decoration: none;
  transition: all 0.1s;
}
.settings-btn:hover, .settings-btn.active { background: var(--bg3); color: var(--text); }

.content { flex: 1; overflow: hidden; }
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
</style>
