<template>
  <div class="folder-picker">
    <div class="path-row">
      <input
        :value="modelValue"
        placeholder="/Users/me/projects/myapp"
        class="path-input"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="btn btn-ghost btn-sm browse-btn" @click="open">Обзор</button>
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
            <button class="btn btn-ghost btn-sm" @click="show = false">Отмена</button>
            <button class="btn btn-primary btn-sm" @click="confirm">Выбрать</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/api'

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

.path-row { display: flex; gap: 6px; align-items: center; }
.path-input {
  flex: 1;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.1s;
}
.path-input:focus { outline: none; border-color: var(--blue); }
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
