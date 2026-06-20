<template>
  <div class="view-content">
    <div class="view-header">
      <h2>Скиллы</h2>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? 'Сохраняю...' : 'Сохранить' }}
      </button>
    </div>

    <div class="tabs">
      <button
        class="tab-btn"
        :class="{ active: tab === 'common' }"
        @click="tab = 'common'"
      >Общие</button>
      <button
        class="tab-btn"
        :class="{ active: tab === 'project' }"
        :disabled="!currentProject"
        @click="tab = 'project'"
      >Для проекта: {{ currentProject?.name ?? '—' }}</button>
    </div>

    <div v-if="tab === 'common'" class="skills-section">
      <p class="hint">
        Общие скиллы применяются ко всем агентам во всех проектах.
        Файл раскладывается в папку агента перед каждым запуском и удаляется после.
      </p>
      <textarea v-model="commonContent" class="skills-editor" placeholder="# Общие инструкции&#10;&#10;- [ ] ..." />
    </div>

    <div v-if="tab === 'project'" class="skills-section">
      <p class="hint">
        Проектные скиллы добавляются после общих для задач этого проекта.
      </p>
      <textarea v-model="projectContent" class="skills-editor" placeholder="# Инструкции для {{ currentProject?.name }}&#10;&#10;..." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'

const appStore = useAppStore()
const currentProject = computed(() => appStore.currentProject)

const tab = ref<'common' | 'project'>('common')
const commonContent = ref('')
const projectContent = ref('')
const saving = ref(false)

async function loadCommon() {
  try {
    const r = await api.get<{ content: string }>('/skills/common')
    commonContent.value = r.content
  } catch { commonContent.value = '' }
}

async function loadProject() {
  if (!currentProject.value) { projectContent.value = ''; return }
  try {
    const r = await api.get<{ content: string }>(`/skills/projects/${currentProject.value.id}`)
    projectContent.value = r.content
  } catch { projectContent.value = '' }
}

async function save() {
  saving.value = true
  try {
    if (tab.value === 'common') {
      await api.put('/skills/common', { content: commonContent.value })
      appStore.toast('Общие скиллы сохранены', 'success')
    } else if (currentProject.value) {
      await api.put(`/skills/projects/${currentProject.value.id}`, { content: projectContent.value })
      appStore.toast('Проектные скиллы сохранены', 'success')
    }
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(() => { loadCommon(); loadProject() })
watch(currentProject, loadProject)
</script>

<style scoped>
.view-content { display: flex; flex-direction: column; gap: 16px; padding: 24px; height: 100%; overflow-y: auto; }
.view-header { display: flex; align-items: center; justify-content: space-between; }
.view-header h2 { font-size: 18px; }
.tabs { display: flex; gap: 8px; }
.tab-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.1s;
}
.tab-btn:disabled { opacity: 0.4; cursor: default; }
.tab-btn.active { background: var(--bg3); color: var(--text); border-color: var(--blue); }
.skills-section { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.hint { font-size: 12px; color: var(--text-muted); }
.skills-editor {
  flex: 1;
  min-height: 400px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  padding: 12px;
  resize: vertical;
}
.skills-editor:focus { outline: none; border-color: var(--blue); }
</style>
