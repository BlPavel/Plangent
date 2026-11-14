<template>
  <div ref="root" class="hm">
    <AppButton variant="subtle" size="sm" :pressed="open" aria-haspopup="menu" :aria-expanded="open" title="Завершённые ревью и ревью других веток" @click="toggle">История ▾</AppButton>
    <AppPopover v-model="open" :anchor="root" align="right" :min-width="300" :max-width="380" role="menu">
      <AppButton v-if="openedId" variant="subtle" size="sm" block role="menuitem" @click="pick(null)">← К текущему ревью</AppButton>
      <div v-if="!history.length" class="hm-empty">Ревью ещё не было</div>
      <div v-for="item in history" :key="item.id" class="hm-row">
        <AppButton class="hm-main" variant="subtle" size="sm" block multiline start :pressed="item.id === openedId" role="menuitem" @click="pick(item.id)">
          <span class="hm-body">
            <span class="hm-title"><span class="hm-number">#{{ item.number }}</span><span class="hm-branch">{{ item.branch ?? 'вне ветки' }}</span></span>
            <span class="hm-meta">{{ historyDetails(item) }}</span>
            <span class="hm-status" :class="item.status">{{ statusLabel(item) }}</span>
          </span>
        </AppButton>
        <span class="hm-delete">
          <AppButton variant="danger-subtle" size="xs" icon title="Удалить ревью вместе с его чатами" :aria-label="`Удалить ревью #${item.number}`" @click.stop="emit('remove', item)"><IconTrash /></AppButton>
        </span>
      </div>
    </AppPopover>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppPopover from '@shared/ui/AppPopover.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import type { ReviewHistory } from '../types'
import { historyDetails, statusLabel } from '../utils/history'

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
/* A review is a card: number, branch and state on the first line, the figures under them; delete sits at the end. */
.hm-row { display: flex; align-items: center; gap: 4px; padding-right: 4px; border-radius: var(--radius-sm); transition: background var(--motion-instant); }
.hm-row:hover { background: var(--bg3); }
/* Delete appears only on the hovered or focused row, as in the chat list. */
.hm-delete { flex-shrink: 0; display: inline-flex; opacity: 0; pointer-events: none; transition: opacity var(--motion-instant); }
.hm-row:hover .hm-delete, .hm-row:focus-within .hm-delete { opacity: 1; pointer-events: auto; }
.hm-main { flex: 1; min-width: 0; }
/* Title and figures on the left, the state centred against both lines on the right. */
.hm-body { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; align-items: center; min-width: 0; text-align: left; }
.hm-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hm-number { font-weight: 600; color: var(--text); }
.hm-branch { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: var(--lh-normal); color: var(--text); }
.hm-status { grid-column: 2; grid-row: 1 / span 2; align-self: center; padding: 0 8px; font-size: var(--fs-xs); font-weight: 500; line-height: var(--lh-normal); border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.hm-status.open { background: var(--blue-soft); color: var(--blue-hover); }
.hm-status.abandoned { background: var(--warning-bg, var(--bg3)); color: var(--warning-text); }
.hm-meta { font-size: var(--fs-xs); font-weight: 400; line-height: var(--lh-normal); color: var(--text-muted); overflow-wrap: anywhere; }
.hm-empty { padding: 10px 8px; font-size: var(--fs-sm); color: var(--text-faint); }
</style>
