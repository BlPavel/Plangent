<template>
  <div ref="root" class="hm">
    <button type="button" class="hm-button" :class="{ on: open }" aria-haspopup="true" :aria-expanded="open" title="Завершённые ревью и ревью других веток" @click="toggle">История ▾</button>
    <div v-if="open" class="hm-pop" role="menu">
      <button v-if="openedId" type="button" class="hm-item" role="menuitem" @click="pick(null)">← К текущему ревью</button>
      <div v-if="!history.length" class="hm-empty">Ревью ещё не было</div>
      <div v-for="item in history" :key="item.id" class="hm-row">
        <button type="button" class="hm-item" :class="{ active: item.id === openedId }" role="menuitem" @click="pick(item.id)">
          <span class="hm-title">#{{ item.number }}<span class="hm-status" :class="item.status">{{ statusLabel(item) }}</span></span>
          <span class="hm-meta">{{ historyLine(item) }}</span>
        </button>
        <button type="button" class="hm-remove" title="Удалить ревью вместе с его чатами" :aria-label="`Удалить ревью #${item.number}`" @click="emit('remove', item)">✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ReviewHistory } from '../types'
import { historyLine, statusLabel } from '../utils/history'

defineProps<{ history: ReviewHistory[]; openedId: string | null }>()
const emit = defineEmits<{ open: []; select: [id: string | null]; remove: [item: ReviewHistory] }>()
const root = ref<HTMLElement>()
const open = ref(false)

function toggle() {
  open.value = !open.value
  if (open.value) emit('open')
}
function pick(id: string | null) { open.value = false; emit('select', id) }

const away = (event: MouseEvent) => { if (open.value && !root.value?.contains(event.target as Node)) open.value = false }
const escape = (event: KeyboardEvent) => { if (open.value && event.key === 'Escape') open.value = false }
onMounted(() => { document.addEventListener('mousedown', away); document.addEventListener('keydown', escape) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape) })
</script>

<style scoped>
.hm { position: relative; }
.hm-button { padding: 2px 8px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.hm-button:hover, .hm-button.on { color: var(--text); }
.hm-pop { position: absolute; right: 0; top: calc(100% + 4px); z-index: 50; width: 420px; max-height: 360px; overflow-y: auto; padding: 4px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.hm-row { display: flex; align-items: flex-start; }
.hm-row .hm-item { flex: 1; min-width: 0; }
.hm-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 6px 8px; font: inherit; font-size: 13px; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.hm-item:hover { background: var(--bg3); }
.hm-item.active { background: var(--blue-soft); }
.hm-remove { flex-shrink: 0; margin: 6px 2px 0 0; padding: 0 6px; font: inherit; font-size: 11px; color: var(--text-faint); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; visibility: hidden; }
.hm-row:hover .hm-remove, .hm-remove:focus-visible { visibility: visible; }
.hm-remove:hover { color: var(--danger-hover); background: var(--bg3); }
.hm-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.hm-status { padding: 0 6px; font-size: 10px; font-weight: 500; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.hm-status.open { background: var(--blue-soft); color: var(--blue-hover); }
.hm-status.abandoned { background: var(--warning-bg, var(--bg3)); color: var(--warning-text); }
.hm-meta { font-size: 11px; color: var(--text-muted); }
.hm-empty { padding: 10px 8px; font-size: 12px; color: var(--text-faint); }
</style>
