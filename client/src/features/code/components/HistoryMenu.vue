<template>
  <div ref="root" class="hm">
    <AppButton variant="subtle" size="sm" :pressed="open" aria-haspopup="menu" :aria-expanded="open" title="Завершённые ревью и ревью других веток" @click="toggle">История ▾</AppButton>
    <AppPopover v-model="open" :anchor="root" align="right" :min-width="300" role="menu">
      <AppButton v-if="openedId" variant="subtle" size="sm" block role="menuitem" @click="pick(null)">← К текущему ревью</AppButton>
      <div v-if="!history.length" class="hm-empty">Ревью ещё не было</div>
      <div v-for="item in history" :key="item.id" class="hm-row">
        <AppButton variant="subtle" size="sm" :pressed="item.id === openedId" role="menuitem" @click="pick(item.id)">
          <span class="hm-title">#{{ item.number }}<span class="hm-status" :class="item.status">{{ statusLabel(item) }}</span></span>
        </AppButton>
        <span class="hm-meta">{{ historyLine(item) }}</span>
        <AppButton variant="danger-ghost" size="xs" icon title="Удалить ревью вместе с его чатами" :aria-label="`Удалить ревью #${item.number}`" @click="emit('remove', item)">✕</AppButton>
      </div>
    </AppPopover>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppPopover from '@shared/ui/AppPopover.vue'
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

</script>

<style scoped>
.hm { position: relative; }
.hm-button { padding: 2px 8px; font: inherit; font-size: var(--fs-sm); color: var(--text-muted); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.hm-button:hover, .hm-button.on { color: var(--text); }
.hm-pop { position: absolute; right: 0; top: calc(100% + 4px); z-index: var(--z-local-menu); width: 420px; max-height: 360px; overflow-y: auto; padding: 4px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.hm-row { display: flex; align-items: flex-start; }
.hm-row .hm-item { flex: 1; min-width: 0; }
.hm-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 6px 8px; font: inherit; font-size: var(--fs-md); text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.hm-item:hover { background: var(--bg3); }
.hm-item.active { background: var(--blue-soft); }
.hm-remove { flex-shrink: 0; margin: 6px 2px 0 0; padding: 0 6px; font: inherit; font-size: var(--fs-xs); color: var(--text-faint); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; visibility: hidden; }
.hm-row:hover .hm-remove, .hm-remove:focus-visible { visibility: visible; }
.hm-remove:hover { color: var(--danger-hover); background: var(--bg3); }
.hm-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.hm-status { padding: 0 6px; font-size: var(--fs-xs); font-weight: 500; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.hm-status.open { background: var(--blue-soft); color: var(--blue-hover); }
.hm-status.abandoned { background: var(--warning-bg, var(--bg3)); color: var(--warning-text); }
.hm-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.hm-empty { padding: 10px 8px; font-size: var(--fs-sm); color: var(--text-faint); }
</style>
