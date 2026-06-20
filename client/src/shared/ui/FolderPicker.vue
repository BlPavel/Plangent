<template>
  <div class="folder-picker">
    <div class="path-row">
      <input
        :value="modelValue"
        placeholder="/Users/me/projects/myapp"
        class="path-input"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <AppButton variant="ghost" class="browse-btn" @click="open">Обзор</AppButton>
    </div>

    <div v-if="show" class="picker-overlay" @mousedown.self="show = false">
      <div class="picker-modal">
        <div class="picker-header">
          <span class="picker-title">Выбор папки</span>
          <button class="btn-close" @click="show = false">✕</button>
        </div>

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
              @click="navigate(currentPath + '/' + entry.name)"
            >
              📁 {{ entry.name }}
            </div>
            <div v-if="!entries.length && !parent" class="empty-dirs">Нет папок</div>
          </template>
        </div>

        <div class="picker-footer">
          <span class="selected-path">{{ currentPath }}</span>
          <div class="picker-actions">
            <AppButton variant="ghost" size="sm" @click="show = false">Отмена</AppButton>
            <AppButton variant="primary" size="sm" @click="confirm">Выбрать</AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@core/api'
import AppButton from './AppButton.vue'

interface BrowseResult {
  path: string
  parent: string | null
  entries: { name: string; isDir: boolean }[]
}

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const show = ref(false)
const currentPath = ref('')
const parent = ref<string | null>(null)
const entries = ref<{ name: string; isDir: boolean }[]>([])
const loading = ref(false)
const error = ref('')

async function navigate(p: string) {
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<BrowseResult>(`/browse?path=${encodeURIComponent(p)}`)
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
.path-input {
  flex: 1;
  height: var(--size-md);
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 0 12px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.path-input::placeholder { color: var(--text-faint); }
.path-input:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.browse-btn { flex-shrink: 0; }

.picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-modal {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
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
.picker-title { font-size: 14px; font-weight: 600; }
.btn-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.btn-close:hover { color: var(--text); }

.current-path {
  padding: 8px 16px;
  background: var(--bg3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.path-text { font-size: 11px; color: var(--text-muted); font-family: monospace; word-break: break-all; }

.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.picker-loading, .picker-error, .empty-dirs {
  padding: 16px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}
.picker-error { color: var(--danger); }

.dir-entry {
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.1s;
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
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
