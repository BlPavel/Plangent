<template>
  <div class="cl">
    <div v-if="!changes.length" class="cl-empty">{{ emptyText }}</div>
    <template v-else>
      <div class="cl-head">
        <span>Изменений: {{ changes.length }}<template v-if="viewable"> · просмотрено {{ viewedCount }} из {{ changes.length }}</template></span>
        <span class="cl-total"><span class="plus">+{{ totals.added }}</span> <span class="minus">−{{ totals.deleted }}</span></span>
      </div>
      <div class="cl-list" role="listbox" tabindex="0" @keydown="onKey">
        <div
          v-for="change in sorted" :key="change.path" class="cl-row" :class="{ selected: change.path === selected }" role="option"
          :aria-selected="change.path === selected" :title="change.originalPath ? `${change.originalPath} → ${change.path}` : change.path" @click="emit('open', change)"
        >
          <input
            v-if="viewable" type="checkbox" class="cl-check" :checked="viewed[change.path] === 'viewed'" :title="viewed[change.path] === 'viewed' ? 'Снять отметку «Просмотрено»' : 'Отметить просмотренным'"
            :aria-label="'Просмотрено: ' + change.path" @click.stop="emit('toggle-viewed', change.path)"
          />
          <span class="cl-status" :class="'st-' + statusClass(change.status)" :title="statusTitle(change.status)">{{ change.status === '?' ? 'U' : change.status }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
          <span class="cl-icon" v-html="iconSvg(fileIconName(nameOf(change.path)))" />
          <span class="cl-name" :class="{ deleted: change.status === 'D' }">{{ nameOf(change.path) }}</span>
          <span class="cl-dir">{{ dirOf(change.path) }}</span>
          <span v-if="viewed[change.path] === 'changed'" class="cl-changed" title="Файл изменился после того, как вы его просмотрели">изменён после просмотра</span>
          <slot name="badges" :change="change" />
          <span v-if="stats[change.path] && !stats[change.path].binary" class="cl-stat"><span class="plus">+{{ stats[change.path].added }}</span> <span class="minus">−{{ stats[change.path].deleted }}</span></span>
          <span v-else-if="stats[change.path]?.binary" class="cl-stat">bin</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fileIconName, iconSvg } from '@shared/code-viewer'
import type { GitChange, LineStat } from '../types'

const props = withDefaults(defineProps<{
  changes: GitChange[]; stats: Record<string, LineStat>; selected: string | null; emptyText: string
  /** «Просмотрено» checkboxes; `viewed` maps a path to its mark. */
  viewable?: boolean; viewed?: Record<string, 'viewed' | 'changed'>; viewedCount?: number
}>(), { viewable: false, viewed: () => ({}), viewedCount: 0 })
const emit = defineEmits<{ open: [change: GitChange]; 'toggle-viewed': [path: string] }>()

const sorted = computed(() => [...props.changes].sort((a, b) => a.path.localeCompare(b.path)))
const totals = computed(() => {
  let added = 0
  let deleted = 0
  for (const change of props.changes) { added += props.stats[change.path]?.added ?? 0; deleted += props.stats[change.path]?.deleted ?? 0 }
  return { added, deleted }
})
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const statusClass = (s: GitChange['status']) => (s === '?' ? 'A' : s === 'C' ? 'R' : s)
const statusTitle = (s: GitChange['status']) => ({ M: 'Изменён', A: 'Добавлен', D: 'Удалён', R: 'Переименован', C: 'Скопирован', U: 'Конфликт', '?': 'Не отслеживается' })[s]

function onKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const list = sorted.value
  if (!list.length) return
  const index = list.findIndex(c => c.path === props.selected)
  const next = list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + (event.key === 'ArrowDown' ? 1 : -1)))]
  emit('open', next)
  event.preventDefault()
}
</script>

<style scoped>
.cl { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.cl-empty { padding: 16px 12px; font-size: 13px; color: var(--text-muted); }
.cl-head { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.cl-list { flex: 1; min-height: 0; overflow-y: auto; outline: none; }
.cl-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 10px; font: inherit; font-size: 13px; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.cl-row:hover { background: var(--bg3); }
.cl-row.selected { background: var(--blue-soft); }
.cl-check { flex-shrink: 0; margin: 0; cursor: pointer; accent-color: var(--blue); }
.cl-changed { flex-shrink: 0; padding: 0 5px; font-size: 10px; color: var(--warning-text); background: var(--bg3); border-radius: var(--radius-pill); white-space: nowrap; }
.cl-status { width: 14px; flex-shrink: 0; font-size: 11px; font-weight: 600; text-align: center; }
.st-M { color: var(--warning); }
.st-A { color: var(--diff-add, #3fb950); }
.st-D { color: var(--diff-del, #f85149); }
.st-R { color: var(--diff-mod, #388bfd); }
.st-U { color: var(--diff-del, #f85149); }
.cl-icon { display: inline-flex; flex-shrink: 0; }
.cl-icon :deep(svg) { width: 16px; height: 16px; }
.cl-name { flex-shrink: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-name.deleted { text-decoration: line-through; color: var(--text-muted); }
.cl-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--text-faint); }
.cl-stat { flex-shrink: 0; font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.plus { color: var(--diff-add, #3fb950); }
.minus { color: var(--diff-del, #f85149); }
</style>
