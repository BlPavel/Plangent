<template>
  <div class="folder-picker">
    <div class="path-row">
      <AppInput
        :model-value="modelValue"
        placeholder="/Users/me/projects/myapp"
        class="path-input"
        @update:model-value="$emit('update:modelValue', $event)"
      />
      <AppButton variant="ghost" class="browse-btn" @click="open">Обзор</AppButton>
    </div>

    <AppModal v-model="show" title="Выбор папки" confirm-label="Выбрать" @confirm="confirm">
        <div class="current-path">
          <span class="path-text">{{ currentPath }}</span>
        </div>

        <div class="picker-body">
          <div v-if="loading" class="picker-loading">Загрузка...</div>
          <div v-else-if="error" class="picker-error">{{ error }}</div>
          <template v-else>
            <div v-if="parent" class="dir-entry parent" @click="navigate(parent)">
              ↑ ..
            </div>
            <div
              v-for="entry in entries"
              :key="entry.name"
              class="dir-entry"
              @click="navigate(entry.path ?? currentPath + '/' + entry.name)"
            >
              {{ entry.path ? '💽' : '📁' }} {{ entry.name }}
            </div>
            <div v-if="!entries.length && !parent" class="empty-dirs">Нет папок</div>
          </template>
        </div>

        <div class="picker-footer"><span class="selected-path">{{ currentPath }}</span></div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { projectsEndpoints } from '../api'

import { ref } from 'vue'
import { platform } from '@core/platform'
import AppButton from '@shared/ui/AppButton.vue'
import AppInput from '@shared/ui/AppInput.vue'
import AppModal from '@shared/ui/AppModal.vue'

// `path` is set for drive entries (the list above a Windows drive root).
interface BrowseEntry { name: string; isDir: boolean; path?: string }


const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const show = ref(false)
const currentPath = ref('')
const parent = ref<string | null>(null)
const entries = ref<BrowseEntry[]>([])
const loading = ref(false)
const error = ref('')

async function navigate(p: string) {
  loading.value = true
  error.value = ''
  try {
    const result = await projectsEndpoints.getBrowse({ params: {  }, query: Object.fromEntries(new URLSearchParams("path=" + encodeURIComponent(p))) })
    currentPath.value = result.path
    parent.value = result.parent
    entries.value = result.entries
  } catch (e: unknown) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

async function open() {
  if (platform.pickFolder) {
    const picked = await platform.pickFolder(props.modelValue || undefined)
    if (picked) emit('update:modelValue', picked)
    return
  }
  show.value = true
  const startPath = props.modelValue || ''
  await navigate(startPath)
}

function confirm() {
  emit('update:modelValue', currentPath.value)
  show.value = false
}
</script>

<style scoped>
.folder-picker { display: flex; flex-direction: column; gap: 0; }

.path-row { display: flex; gap: 8px; align-items: center; }
.path-input { flex: 1; }
.browse-btn { flex-shrink: 0; }

.picker-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-picker);
  z-index: var(--z-picker);
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-modal {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 500px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.picker-title { font-size: var(--fs-base); font-weight: 600; }

.current-path {
  padding: 8px 16px;
  background: var(--bg3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.path-text { font-size: var(--fs-xs); color: var(--text-muted); font-family: var(--font-mono); word-break: break-all; }

.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.picker-loading, .picker-error, .empty-dirs {
  padding: 16px;
  font-size: var(--fs-md);
  color: var(--text-muted);
  text-align: center;
}
.picker-error { color: var(--danger); }

.dir-entry {
  padding: 8px 16px;
  font-size: var(--fs-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background var(--motion-instant);
}
.dir-entry:hover { background: var(--bg3); }
.dir-entry.parent { color: var(--text-muted); }

.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.selected-path {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>

