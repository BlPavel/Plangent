<template>
  <div class="file-tree">
    <div class="tree-toolbar">
      <label class="tree-toggle" title="Показать файлы, которые игнорирует git">
        <input type="checkbox" :checked="showIgnored" @change="emit('update:showIgnored', ($event.target as HTMLInputElement).checked)" />
        Показать игнорируемые
      </label>
    </div>
    <div ref="list" class="tree-list" role="tree" tabindex="0" @keydown="onKey">
      <div v-if="!trees['']" class="tree-note">Загрузка…</div>
      <div v-else-if="!rows.length" class="tree-note">Файлов нет</div>
      <template v-for="row in rows" :key="row.key">
        <div v-if="row.kind === 'loading'" class="tree-note" :style="indent(row.depth)">Загрузка…</div>
        <div
          v-else
          class="tree-row"
          :class="[row.entry.status ? 'st-' + statusClass(row.entry.status) : '', { selected: row.entry.path === selected, focused: row.entry.path === focused, ignored: row.entry.ignored, dir: row.entry.directory }]"
          :style="indent(row.depth)"
          role="treeitem"
          :aria-expanded="row.entry.directory ? expanded.has(row.entry.path) : undefined"
          :aria-selected="row.entry.path === selected"
          :data-path="row.entry.path"
          :title="row.entry.path"
          @click="activate(row.entry)"
        >
          <span class="tree-chevron" :class="{ open: expanded.has(row.entry.path) }">{{ row.entry.directory ? '›' : '' }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
          <span class="tree-icon" v-html="iconSvg(row.entry.directory ? folderIconName(row.entry.name, expanded.has(row.entry.path)) : fileIconName(row.entry.name))" />
          <span class="tree-name">{{ row.entry.name }}</span>
          <span v-if="markCount(row.entry) > 0" class="tree-marks" :title="`Замечаний: ${markCount(row.entry)}`">💬{{ markCount(row.entry) }}</span>
          <span v-if="row.entry.directory && row.entry.changes > 0" class="tree-count" :title="`Изменённых файлов: ${row.entry.changes}`">{{ row.entry.changes }}</span>
          <span v-else-if="row.entry.status" class="tree-status" :title="statusTitle(row.entry.status)">{{ row.entry.status === '?' ? 'U' : row.entry.status }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { fileIconName, folderIconName, iconSvg } from './file-icons'
import type { ChangeStatus, TreeNode } from './types'

const props = defineProps<{
  /** Loaded levels by directory path ('' is the root). Missing levels are requested via `load`. */
  trees: Record<string, TreeNode[]>
  selected?: string | null
  showIgnored?: boolean
  /** Badge counts by file path (e.g. review comments); folders show the sum of their files. */
  marks?: Record<string, number>
}>()
const emit = defineEmits<{
  load: [path: string]
  select: [path: string]
  'update:showIgnored': [value: boolean]
}>()

type EntryRow = { kind: 'entry'; key: string; depth: number; entry: TreeNode }
type Row = EntryRow | { kind: 'loading'; key: string; depth: number }

const expanded = reactive(new Set<string>())
const focused = ref<string | null>(null)
const list = ref<HTMLElement>()

const rows = computed<Row[]>(() => {
  const result: Row[] = []
  const walk = (path: string, depth: number) => {
    const level = props.trees[path]
    if (!level) { if (path !== '') result.push({ kind: 'loading', key: 'loading:' + path, depth }); return }
    for (const entry of level) {
      result.push({ kind: 'entry', key: entry.path, depth, entry })
      if (entry.directory && expanded.has(entry.path)) walk(entry.path, depth + 1)
    }
  }
  walk('', 0)
  return result
})

function markCount(entry: TreeNode): number {
  const marks = props.marks
  if (!marks) return 0
  if (!entry.directory) return marks[entry.path] ?? 0
  let sum = 0
  for (const [path, count] of Object.entries(marks)) if (path.startsWith(entry.path + '/')) sum += count
  return sum
}
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 + 'px' })
const statusClass = (s: ChangeStatus) => (s === '?' ? 'A' : s === 'C' ? 'R' : s)
const statusTitle = (s: ChangeStatus) => ({ M: 'Изменён', A: 'Добавлен', D: 'Удалён', R: 'Переименован', C: 'Скопирован', U: 'Конфликт', '?': 'Не отслеживается' })[s]

function expand(path: string) {
  expanded.add(path)
  if (!props.trees[path]) emit('load', path)
}
function activate(entry: TreeNode) {
  focused.value = entry.path
  if (!entry.directory) emit('select', entry.path)
  else if (expanded.has(entry.path)) expanded.delete(entry.path)
  else expand(entry.path)
}

function scrollTo(path: string) {
  void nextTick(() => {
    const row = Array.from(list.value?.querySelectorAll<HTMLElement>('.tree-row') ?? []).find(el => el.dataset.path === path)
    row?.scrollIntoView({ block: 'nearest' })
  })
}

function onKey(event: KeyboardEvent) {
  const entries = rows.value.filter((r): r is EntryRow => r.kind === 'entry')
  if (!entries.length) return
  const index = entries.findIndex(r => r.entry.path === focused.value)
  const current = entries[index]
  const move = (to: number) => {
    const target = entries[Math.max(0, Math.min(entries.length - 1, to))]
    focused.value = target.entry.path
    scrollTo(target.entry.path)
  }
  switch (event.key) {
    case 'ArrowDown': move(index + 1); break
    case 'ArrowUp': move(index < 0 ? 0 : index - 1); break
    case 'Home': move(0); break
    case 'End': move(entries.length - 1); break
    case 'ArrowRight':
      if (current?.entry.directory) { if (expanded.has(current.entry.path)) move(index + 1); else expand(current.entry.path) }
      break
    case 'ArrowLeft': {
      if (!current) break
      if (current.entry.directory && expanded.has(current.entry.path)) { expanded.delete(current.entry.path); break }
      for (let i = index - 1; i >= 0; i--) if (entries[i].depth < current.depth) { move(i); break }
      break
    }
    case 'Enter': case ' ': if (current) activate(current.entry); break
    default: return
  }
  event.preventDefault()
}

/** "Show in tree": expands every ancestor of the path (requesting missing levels) and scrolls to it. */
function reveal(path: string) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) expand(parts.slice(0, i).join('/'))
  focused.value = path
  pendingReveal = path
  scrollTo(path)
}
// Levels load asynchronously: keep trying to scroll until the row exists.
let pendingReveal: string | null = null
watch(rows, () => {
  if (pendingReveal === null) return
  if (rows.value.some(r => r.kind === 'entry' && r.entry.path === pendingReveal)) { scrollTo(pendingReveal); pendingReveal = null }
})

onMounted(() => {
  if (!props.trees['']) emit('load', '')
  if (props.selected) reveal(props.selected)
})
defineExpose({ reveal, collapseAll: () => expanded.clear() })
</script>

<style scoped>
.file-tree { display: flex; flex-direction: column; min-height: 0; height: 100%; font-size: 13px; }
.tree-toolbar { flex-shrink: 0; padding: 6px 10px; border-bottom: 1px solid var(--border); }
.tree-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); cursor: pointer; user-select: none; }
.tree-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; outline: none; }
.tree-note { padding: 6px 12px; color: var(--text-faint); font-size: 12px; }
.tree-row {
  display: flex; align-items: center; gap: 4px; height: 24px; padding-right: 8px;
  color: var(--text); cursor: pointer; white-space: nowrap; user-select: none;
}
.tree-row:hover { background: var(--bg-hover); }
.tree-row.selected { background: var(--blue-soft); }
.tree-list:focus-visible .tree-row.focused { outline: 1px solid var(--blue); outline-offset: -1px; }
.tree-row.ignored { opacity: 0.55; }
.tree-chevron { width: 12px; flex-shrink: 0; text-align: center; color: var(--text-faint); transition: transform 0.1s; }
.tree-chevron.open { transform: rotate(90deg); }
.tree-icon { display: inline-flex; flex-shrink: 0; }
.tree-icon :deep(svg) { width: 16px; height: 16px; }
.tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tree-status, .tree-count { flex-shrink: 0; font-size: 11px; font-weight: 600; }
.tree-marks { flex-shrink: 0; font-size: 10px; color: var(--text-muted); }
.tree-count { min-width: 16px; padding: 0 5px; text-align: center; border-radius: var(--radius-pill); background: var(--bg3); }
.st-M { color: var(--warning-text); }
.st-A { color: var(--accent-hover); }
.st-D { color: var(--danger-hover); }
.st-D:not(.dir) .tree-name { text-decoration: line-through; }
.st-R { color: var(--blue-hover); }
.st-U { color: var(--danger-hover); }
</style>
