<template>
  <div class="cl">
    <div v-if="!changes.length" class="cl-empty"><slot name="empty">{{ emptyText }}</slot></div>
    <div v-else class="cl-list" role="listbox" tabindex="0" @keydown="onKey">
      <template v-for="group in groups" :key="group.id">
        <div v-if="group.title" class="cl-group">
          <input
            v-if="stageable" type="checkbox" class="cl-check" :checked="group.items.every(staged)" :indeterminate.prop="group.items.some(staged) && !group.items.every(staged)"
            :disabled="!!stageDisabled" :title="stageDisabled || 'Все к коммиту'" :aria-label="'К коммиту: ' + group.title" @change="emit('stage-many', group.items, !group.items.every(staged))"
          />
          <span class="cl-group-title">{{ group.title }}</span>
          <span class="cl-count">{{ group.items.length }}</span>
        </div>
        <div
          v-for="change in group.items" :key="change.path" class="cl-row" :class="{ selected: change.path === selected }" role="option"
          :aria-selected="change.path === selected" :title="change.originalPath ? `${change.originalPath} → ${change.path}` : change.path" @click="emit('open', change)"
        >
          <input v-if="stageable" type="checkbox" class="cl-check" :checked="staged(change)" :disabled="!!stageDisabled" :title="stageDisabled || 'К коммиту'" :aria-label="'К коммиту: ' + change.path" @click.stop @change="emit('toggle-stage', change)" />
          <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
          <span class="cl-icon" v-html="iconSvg(fileIconName(nameOf(change.path)))" />
          <span class="cl-name" :class="{ deleted: change.status === 'D' }">{{ nameOf(change.path) }}</span>
          <span class="cl-dir">{{ dirOf(change.path) }}</span>
          <slot name="badges" :change="change" />
          <span v-if="stats[change.path] && !stats[change.path].binary" class="cl-stat"><span class="plus">+{{ stats[change.path].added }}</span> <span class="minus">−{{ stats[change.path].deleted }}</span></span>
          <span v-else-if="stats[change.path]?.binary" class="cl-stat">bin</span>
          <span class="cl-status" :class="'st-' + statusClass(change.status)" :title="statusTitle(change.status)">{{ change.status === '?' ? 'U' : change.status }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fileIconName, iconSvg } from '@shared/code-viewer'
import type { GitChange, LineStat } from '../types'

/** Changed files; with `stageable` they split into tracked and new, each with its «к коммиту» checkboxes. */
const props = withDefaults(defineProps<{
  changes: GitChange[]; stats: Record<string, LineStat>; selected: string | null; emptyText?: string
  stageable?: boolean; stageDisabled?: string
}>(), { emptyText: '', stageDisabled: '' })
const emit = defineEmits<{ open: [change: GitChange]; 'toggle-stage': [change: GitChange]; 'stage-many': [changes: GitChange[], stage: boolean] }>()

/** A conflicted file is not staged yet: ticking it (`git add`) marks the conflict resolved. */
const staged = (change: GitChange) => change.status !== 'U' && !['.', ' ', '?'].includes(change.indexStatus)
const sorted = computed(() => [...props.changes].sort((a, b) => a.path.localeCompare(b.path)))
const groups = computed(() => {
  if (!props.stageable) return [{ id: 'all', title: '', items: sorted.value }]
  return [
    { id: 'tracked', title: 'Отслеживаемые', items: sorted.value.filter(c => c.status !== '?') },
    { id: 'new', title: 'Новые', items: sorted.value.filter(c => c.status === '?') },
  ].filter(group => group.items.length)
})
/** Keyboard order follows the groups on screen. */
const ordered = computed(() => groups.value.flatMap(group => group.items))
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const statusClass = (s: GitChange['status']) => (s === '?' ? 'A' : s === 'C' ? 'R' : s)
const statusTitle = (s: GitChange['status']) => ({ M: 'Изменён', A: 'Добавлен', D: 'Удалён', R: 'Переименован', C: 'Скопирован', U: 'Конфликт', '?': 'Не отслеживается' })[s]

function onKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const list = ordered.value
  if (!list.length) return
  const index = list.findIndex(c => c.path === props.selected)
  const next = list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + (event.key === 'ArrowDown' ? 1 : -1)))]
  emit('open', next)
  event.preventDefault()
}
</script>

<style scoped>
.cl { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.cl-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px 12px; font-size: 13px; text-align: center; color: var(--text-muted); }
.cl-list { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 6px; outline: none; }
.cl-group { display: flex; align-items: center; gap: 6px; padding: 8px 10px 3px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.cl-group-title { flex: 1; }
.cl-count { font-weight: 500; }
.cl-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 10px; font: inherit; font-size: 13px; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.cl-row:hover { background: var(--bg3); }
.cl-row.selected { background: var(--blue-soft); }
.cl-check { flex-shrink: 0; margin: 0; cursor: pointer; accent-color: var(--blue); }
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
