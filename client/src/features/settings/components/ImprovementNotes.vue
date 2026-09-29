<template>
  <div class="notes">
    <div class="notes-row">
      <p class="hint">Что поправить в Plangent в будущем — по пунктам, в свободной форме. Сохраняется автоматически.</p>
      <span class="status" :class="status">{{ statusLabel }}</span>
    </div>
    <textarea
      v-model="content"
      class="notes-editor"
      spellcheck="false"
      :disabled="loading"
      placeholder="- Что поменять и почему&#10;- …"
      @input="scheduleSave"
      @blur="flush"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '@core/api'

const KEY = 'improvement-notes'

const content = ref('')
const savedContent = ref('')
const loading = ref(true)
const status = ref<'saved' | 'dirty' | 'saving' | 'error'>('saved')
let timer: ReturnType<typeof setTimeout> | null = null

const statusLabel = computed(() => ({
  saved: 'Сохранено', dirty: 'Есть изменения…', saving: 'Сохранение…', error: 'Не удалось сохранить — повторю при следующей правке',
})[status.value])

function scheduleSave() {
  status.value = 'dirty'
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 700)
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  if (loading.value || content.value === savedContent.value) return
  const value = content.value
  status.value = 'saving'
  try {
    await api.put(`/settings/${KEY}`, { value })
    savedContent.value = value
    status.value = content.value === value ? 'saved' : 'dirty'
  } catch {
    status.value = 'error'
  }
}

// Last-chance save when the window closes mid-debounce.
function onBeforeUnload() {
  if (content.value === savedContent.value) return
  void fetch(`/api/settings/${KEY}`, {
    method: 'PUT', keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: content.value }),
  })
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  try {
    const r = await api.get<{ value: string }>(`/settings/${KEY}`)
    content.value = savedContent.value = r.value
  } catch {
    status.value = 'error'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  void flush()
})
</script>

<style scoped>
.notes { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.notes-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.status { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
.status.error { color: var(--danger-hover); }

.notes-editor {
  width: 100%;
  flex: 1;
  min-height: 320px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12.5px;
  line-height: 1.55;
  padding: 12px;
  resize: vertical;
}
.notes-editor:focus { outline: none; border-color: var(--blue); }
</style>
