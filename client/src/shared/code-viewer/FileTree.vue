<template>
  <div class="file-tree">
    <div class="tree-toolbar">
      <AppCheckbox :model-value="showIgnored" title="Показать файлы, которые игнорирует git" @update:model-value="emit('update:showIgnored', $event)">Показать игнорируемые
      </AppCheckbox>
    </div>
    <div ref="list" class="tree-list" role="tree" tabindex="0" @keydown="onKey" @scroll.passive="onScroll">
      <div v-if="!trees['']" class="tree-note">Загрузка…</div>
      <AppEmptyState v-else-if="!rows.length" small description="Файлов нет" />
      <div v-else class="tree-body" :style="{ height: rows.length * ROW + 'px' }">
        <div class="tree-window" :style="{ transform: `translateY(${first * ROW}px)` }">
          <template v-for="row in visibleRows" :key="row.key">
            <div v-if="row.kind === 'loading'" class="tree-note tree-pending" :style="indent(row.depth)">Загрузка…</div>
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
              :draggable="draggable"
              @dragstart="emit('drag-path', $event, row.entry.path, row.entry.directory)"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import AppCheckbox from '@shared/ui/AppCheckbox.vue'
import AppEmptyState from '@shared/ui/AppEmptyState.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { fileIconName, folderIconName, iconSvg } from './file-icons'
import type { ChangeStatus, TreeNode } from './types'

const props = defineProps<{
  /** Loaded levels by directory path ('' is the root). Missing levels are requested via `load`. */
  trees: Record<string, TreeNode[]>
  selected?: string | null
  showIgnored?: boolean
  draggable?: boolean
  /** Badge counts by file path (e.g. review comments); folders show the sum of their files. */
  marks?: Record<string, number>
}>()
const emit = defineEmits<{
  load: [path: string]
  select: [path: string]
  'drag-path': [event: DragEvent, path: string, directory: boolean]
  'update:showIgnored': [value: boolean]
}>()

type EntryRow = { kind: 'entry'; key: string; depth: number; entry: TreeNode }
type Row = EntryRow | { kind: 'loading'; key: string; depth: number }

// Only the rows in view are rendered: an expanded folder may hold thousands of entries.
const ROW = 24
const OVERSCAN = 10

const expanded = reactive(new Set<string>())
const focused = ref<string | null>(null)
const list = ref<HTMLElement>()
const scrollTop = ref(0)
const height = ref(600)

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

const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN))
const visibleRows = computed(() => rows.value.slice(first.value, Math.ceil((scrollTop.value + height.value) / ROW) + OVERSCAN))
function onScroll() { scrollTop.value = list.value?.scrollTop ?? 0 }

/** Folder sums of the badge counts, once per change of `marks` rather than per rendered row. */
const folderMarks = computed(() => {
  const sums = new Map<string, number>()
  for (const [path, count] of Object.entries(props.marks ?? {})) {
    for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) {
      const folder = path.slice(0, i)
      sums.set(folder, (sums.get(folder) ?? 0) + count)
    }
  }
  return sums
})
function markCount(entry: TreeNode): number {
  return (entry.directory ? folderMarks.value.get(entry.path) : props.marks?.[entry.path]) ?? 0
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

/** Scrolls by the row's index: rows outside the window are not in the DOM. */
function scrollTo(path: string) {
  void nextTick(() => {
    const el = list.value
    const index = rows.value.findIndex(r => r.kind === 'entry' && r.entry.path === path)
    if (!el || index < 0) return
    const top = index * ROW
    const view = el.clientHeight || height.value
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + view) el.scrollTop = top + ROW - view
    onScroll()
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

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(() => { height.value = list.value?.clientHeight || height.value })
  if (list.value) observer.observe(list.value)
  if (!props.trees['']) emit('load', '')
  if (props.selected) reveal(props.selected)
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ reveal, collapseAll: () => expanded.clear() })
</script>

<style scoped>
.file-tree { display: flex; flex-direction: column; min-height: 0; height: 100%; font-size: var(--fs-md); }
.tree-toolbar { flex-shrink: 0; padding: 6px 10px; border-bottom: 1px solid var(--border); }
.tree-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-muted); cursor: pointer; user-select: none; }
.tree-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; outline: none; }
.tree-body { position: relative; }
.tree-window { position: absolute; top: 0; left: 0; right: 0; }
.tree-note { padding: 6px 12px; color: var(--text-faint); font-size: var(--fs-sm); }
.tree-pending { box-sizing: border-box; display: flex; align-items: center; height: 24px; padding-block: 0; }
.tree-row {
  display: flex; align-items: center; gap: 4px; height: 24px; padding-right: 8px;
  color: var(--text); cursor: pointer; white-space: nowrap; user-select: none;
}
.tree-row:hover { background: var(--bg-hover); }
.tree-row.selected { background: var(--blue-soft); }
.tree-list:focus-visible .tree-row.focused { outline: 1px solid var(--blue); outline-offset: -1px; }
.tree-row.ignored { opacity: 0.55; }
.tree-chevron { width: 12px; flex-shrink: 0; text-align: center; color: var(--text-faint); transition: transform var(--motion-instant); }
.tree-chevron.open { transform: rotate(90deg); }
.tree-icon { display: inline-flex; flex-shrink: 0; }
.tree-icon :deep(svg) { width: 16px; height: 16px; }
.tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tree-status, .tree-count { flex-shrink: 0; font-size: var(--fs-xs); font-weight: var(--fw-semibold); }
.tree-marks { flex-shrink: 0; font-size: var(--fs-xs); color: var(--text-muted); }
.tree-count { min-width: 16px; padding: 0 5px; text-align: center; border-radius: var(--radius-pill); background: var(--bg3); }
.st-M { color: var(--warning-text); }
.st-A { color: var(--accent-hover); }
.st-D { color: var(--danger-hover); }
.st-D:not(.dir) .tree-name { text-decoration: line-through; }
.st-R { color: var(--blue-hover); }
.st-U { color: var(--danger-hover); }
</style>
