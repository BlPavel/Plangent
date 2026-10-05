<template>
  <div class="code-view" :class="{ 'diff-mode': effectiveMode === 'diff' }" :style="{ '--digits': gutter.digits, '--cols': gutter.columns }">
    <div class="cv-header">
      <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
      <span class="cv-icon" v-html="iconSvg(fileIconName(file.path.split('/').pop() ?? ''))" />
      <span class="cv-path" :title="file.path"><template v-if="originalPath && originalPath !== file.path"><span class="cv-rename">R</span> {{ originalPath }} → </template>{{ file.path }}</span>
      <template v-if="hasDiff">
        <span class="cv-stats" title="Добавлено / удалено строк"><span class="cv-plus">+{{ stats.added }}</span> <span class="cv-minus">−{{ stats.deleted }}</span></span>
        <span v-if="blockRows.length" class="cv-nav">
          <button type="button" title="Предыдущее изменение" @click="step(-1)">↑</button>
          <span class="cv-nav-count">{{ currentBlock >= 0 ? currentBlock + 1 : '–' }}/{{ blockRows.length }}</span>
          <button type="button" title="Следующее изменение" @click="step(1)">↓</button>
        </span>
        <label v-if="effectiveMode === 'diff' && ignoreWhitespace !== undefined" class="cv-check" title="Игнорировать пробелы и переводы строк">
          <input v-model="ignoreWhitespace" type="checkbox" /> без пробелов
        </label>
        <button v-if="effectiveMode === 'diff' && hasFolds" type="button" class="cv-link" @click="expandAll = !expandAll">{{ expandAll ? 'Свернуть' : 'Развернуть всё' }}</button>
        <div class="cv-toggle" role="group" aria-label="Режим просмотра">
          <button type="button" :class="{ on: effectiveMode === 'diff' }" @click="mode = 'diff'">Diff</button>
          <button type="button" :class="{ on: effectiveMode === 'file' }" @click="mode = 'file'">Файл</button>
        </div>
      </template>
      <div v-if="isMarkdown && effectiveMode === 'file'" class="cv-toggle" role="group" aria-label="Режим markdown">
        <button type="button" :class="{ on: markdownMode === 'preview' }" @click="markdownMode = 'preview'">Превью</button>
        <button type="button" :class="{ on: markdownMode === 'source' }" @click="markdownMode = 'source'">Исходник</button>
      </div>
      <slot name="header" :path="file.path" />
    </div>

    <div v-if="findOpen && canFind" class="cv-find" role="search">
      <input
        ref="findInput" v-model="findText" class="cv-find-input" :class="{ invalid: !!findError }" placeholder="Найти в файле" spellcheck="false"
        :title="findError" @keydown.enter.prevent="stepFind($event.shiftKey ? -1 : 1)" @keydown.esc.prevent="closeFind"
      />
      <button type="button" class="cv-find-opt" :class="{ on: findCase }" title="Учитывать регистр" @click="findCase = !findCase">Aa</button>
      <button type="button" class="cv-find-opt" :class="{ on: findWord }" title="Слово целиком" @click="findWord = !findWord">ab</button>
      <button type="button" class="cv-find-opt" :class="{ on: findRegex }" title="Регулярное выражение" @click="findRegex = !findRegex">.*</button>
      <span class="cv-find-count">{{ !findText ? '' : findError ? 'ошибка' : hits.length ? `${activeHit + 1} из ${hits.length}` : 'нет совпадений' }}</span>
      <button type="button" class="cv-find-opt" title="Предыдущее (Shift+Enter)" :disabled="!hits.length" @click="stepFind(-1)">↑</button>
      <button type="button" class="cv-find-opt" title="Следующее (Enter)" :disabled="!hits.length" @click="stepFind(1)">↓</button>
      <button type="button" class="cv-find-opt" title="Закрыть (Esc)" @click="closeFind">×</button>
    </div>

    <slot name="notes" :path="file.path" />

    <div v-if="file.kind === 'image'" class="cv-note cv-image">
      <img v-if="imageSrc" :src="imageSrc" :alt="file.path" />
      <span v-else>Превью недоступно</span>
    </div>
    <div v-else-if="file.kind === 'binary'" class="cv-note">Бинарный файл ({{ formatSize(file.size) }})</div>
    <div v-else-if="file.kind === 'too-large'" class="cv-note">Файл слишком большой ({{ formatSize(file.size) }}), просмотр отключён</div>
    <div v-else-if="isMarkdown && effectiveMode === 'file' && markdownMode === 'preview'" class="cv-preview">
      <MessageMarkdown :key="file.path" :text="file.content ?? ''" />
    </div>
    <div v-else-if="effectiveMode === 'diff' && !rows.length" class="cv-note">Изменений нет</div>
    <div v-else ref="scroller" class="cv-scroll" @scroll.passive="onScroll">
      <div class="cv-body" :style="{ height: totalHeight + 'px' }">
        <div class="cv-window" :style="{ transform: `translateY(${windowTop}px)` }">
          <template v-for="index in visible" :key="index">
            <div v-if="rows[index].kind === 'fold'" class="cv-line cv-fold">
              <span class="cv-gutter" />
              <button type="button" class="cv-fold-button" @click="expandFold(foldStart(rows[index]))">⋯ Показать {{ foldCount(rows[index]) }} {{ plural(foldCount(rows[index])) }}</button>
            </div>
            <div v-else class="cv-line" :class="lineClass(rows[index])" :data-line="lineOf(rows[index])" :data-side="sideOf(rows[index])">
              <span class="cv-gutter" :class="stripeClass(rows[index])" @mousedown.prevent="startSelect(rows[index], $event)" @mouseenter="extendSelect(rows[index])">
                <button
                  v-if="markerFor(rows[index])"
                  type="button"
                  class="cv-marker"
                  :title="markerFor(rows[index])?.title ?? 'Замечания к строке'"
                  @mousedown.stop
                  @click.stop="emit('marker-click', lineOf(rows[index]), sideOf(rows[index]))"
                >💬<sup v-if="(markerFor(rows[index])?.count ?? 0) > 1">{{ markerFor(rows[index])?.count }}</sup></button>
                <span v-if="gutter.old" class="cv-number cv-old">{{ oldNumber(rows[index]) }}</span>
                <span v-if="gutter.new" class="cv-number">{{ newNumber(rows[index]) }}</span>
              </span>
              <span v-if="effectiveMode === 'diff'" class="cv-sign">{{ signOf(rows[index]) }}</span>
              <!-- eslint-disable-next-line vue/no-v-html -- highlight.js output is escaped -->
              <code class="cv-text hljs" v-html="htmlOf(rows[index], index) || ' '" />
            </div>
            <div v-if="widgetSet.has(widgetKey(rows[index]))" :ref="el => watchWidget(el as HTMLElement | null, widgetKey(rows[index]))" class="cv-widget">
              <slot name="widget" :line="lineOf(rows[index])" :side="sideOf(rows[index])" :path="file.path" />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import { changeBlocks, diffRows, diffStats, fileRows, stripes, type DiffHunk, type DiffRow } from './diff-model'
import { fileIconName, iconSvg } from './file-icons'
import { findInLine, findPattern, markHtml, type TextRange } from './find'
import { highlightLines } from './highlight'
import type { CodeSide, LineMarker, LineSelection, ViewerFile } from './types'

const LINE_HEIGHT = 20
const OVERSCAN = 20
const WIDGET_ESTIMATE = 96

const props = withDefaults(defineProps<{
  file: ViewerFile
  /** URL for image files. */
  imageSrc?: string
  /** Which version of the file is shown in "file" mode; reported back in `select`. */
  side?: CodeSide
  /** Hunks of the file against the chosen base; enables the Diff mode and the margin stripes. */
  hunks?: DiffHunk[]
  /** Pre-rename path, shown as `R old → new`. */
  originalPath?: string
  markers?: LineMarker[]
  /** Markers on removed lines (Diff mode), keyed by old line. */
  oldMarkers?: LineMarker[]
  /** New-side lines that get a `widget` slot rendered under them. */
  widgetLines?: number[]
  /** Old-side lines of removed rows that get a `widget` slot. */
  oldWidgetLines?: number[]
}>(), { side: 'new', imageSrc: undefined, hunks: undefined, originalPath: undefined, markers: () => [], oldMarkers: () => [], widgetLines: () => [], oldWidgetLines: () => [] })
const emit = defineEmits<{
  select: [selection: LineSelection]
  'marker-click': [line: number, side: CodeSide]
}>()
defineSlots<{
  header?(props: { path: string }): unknown
  widget?(props: { line: number; side: CodeSide; path: string }): unknown
  /** Full-width area between the header and the content, e.g. file-level comments. */
  notes?(props: { path: string }): unknown
}>()
const mode = defineModel<'diff' | 'file'>('mode', { default: 'file' })
/** A boolean from the consumer shows the "ignore whitespace" checkbox; the consumer refetches the hunks. */
const ignoreWhitespace = defineModel<boolean | undefined>('ignoreWhitespace', { default: undefined })

const scroller = ref<HTMLElement>()
const markdownMode = ref<'preview' | 'source'>('preview')
const scrollTop = ref(0)
const viewHeight = ref(600)
const widgetHeights = reactive(new Map<string, number>())
const expanded = reactive(new Set<number>())
const expandAll = ref(false)
const currentBlock = ref(-1)

const hasDiff = computed(() => props.file.kind === 'text' && props.hunks !== undefined)
const effectiveMode = computed(() => (hasDiff.value ? mode.value : 'file'))
const isMarkdown = computed(() => props.file.kind === 'text' && /\.(md|markdown|mdx)$/i.test(props.file.path))
const content = computed(() => props.file.content ?? '')
const lineHtml = computed(() => (props.file.kind === 'text' && content.value !== '' ? highlightLines(props.file.path, content.value) : []))
const lineCount = computed(() => lineHtml.value.length)
const hunkList = computed(() => props.hunks ?? [])
const stats = computed(() => diffStats(hunkList.value))
const stripeAt = computed(() => (hasDiff.value && effectiveMode.value === 'file' ? stripes(hunkList.value, lineCount.value) : new Map()))
const rows = computed<DiffRow[]>(() => {
  if (props.file.kind !== 'text') return []
  return effectiveMode.value === 'diff'
    ? diffRows(hunkList.value, lineCount.value, { expanded, expandAll: expandAll.value })
    : fileRows(lineCount.value)
})
/** Width of the line numbers; a diff shows only the sides it has (a new file has no old numbers). */
const gutter = computed(() => {
  const diff = effectiveMode.value === 'diff'
  const old = diff && rows.value.some(row => row.kind === 'deleted' || (row.kind === 'context' && row.oldLine !== undefined))
  const fresh = !diff || rows.value.some(row => row.kind === 'added' || row.kind === 'context')
  const last = Math.max(lineCount.value, ...hunkList.value.map(hunk => hunk.oldStart + hunk.oldLines))
  return { old, new: fresh, digits: Math.max(2, String(last).length), columns: Number(old) + Number(fresh) }
})
const hasFolds = computed(() => expandAll.value || expanded.size > 0 || rows.value.some(row => row.kind === 'fold'))

/** Row index of the first row of every change block, in order. */
const blockRows = computed<number[]>(() => {
  if (!hasDiff.value) return []
  if (effectiveMode.value === 'file') return changeBlocks(hunkList.value).map(block => Math.max(0, Math.min(lineCount.value - 1, block.newLine - 1)))
  const result: number[] = []
  const changed = (row?: DiffRow) => row?.kind === 'added' || row?.kind === 'deleted'
  rows.value.forEach((row, index) => { if (changed(row) && !changed(rows.value[index - 1])) result.push(index) })
  return result
})

const sideOf = (row: DiffRow): CodeSide => (row.kind === 'deleted' ? 'old' : 'new')
const lineOf = (row: DiffRow): number => (row.kind === 'deleted' ? row.oldLine : row.kind === 'fold' ? row.start : row.newLine)
const foldStart = (row: DiffRow) => (row.kind === 'fold' ? row.start : 0)
const foldCount = (row: DiffRow) => (row.kind === 'fold' ? row.count : 0)
const oldNumber = (row: DiffRow) => (row.kind === 'deleted' ? row.oldLine : row.kind === 'context' ? row.oldLine ?? '' : '')
const newNumber = (row: DiffRow) => (row.kind === 'added' || row.kind === 'context' ? row.newLine : '')
const signOf = (row: DiffRow) => (row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : '')
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'строку' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'строки' : 'строк')
const widgetKey = (row: DiffRow) => sideOf(row) + ':' + lineOf(row)
const lineClass = (row: DiffRow) => ({ selected: isSelected(row), added: row.kind === 'added', deleted: row.kind === 'deleted' })
const stripeClass = (row: DiffRow) => (row.kind === 'context' && effectiveMode.value === 'file' ? 'stripe-' + (stripeAt.value.get(row.newLine) ?? 'none') : '')

const markerAt = computed(() => new Map(props.markers.map(m => [m.line, m])))
const oldMarkerAt = computed(() => new Map(props.oldMarkers.map(m => [m.line, m])))
const markerFor = (row: DiffRow) => (row.kind === 'deleted' ? oldMarkerAt.value.get(row.oldLine) : row.kind === 'fold' ? undefined : markerAt.value.get(row.newLine))

const deletedHtml = new Map<string, string>()
function plainHtml(row: DiffRow): string {
  if (row.kind === 'fold') return ''
  if (row.kind !== 'deleted') return lineHtml.value[row.newLine - 1]
  let html = deletedHtml.get(row.text)
  if (html === undefined) { html = highlightLines(props.file.path, row.text)[0] ?? ''; deletedHtml.set(row.text, html) }
  return html
}
function htmlOf(row: DiffRow, index: number): string {
  const html = plainHtml(row)
  const found = rowHits.value.get(index)
  return found ? markHtml(html, found.ranges, found.current) : html
}

// In-file search (Ctrl+F): matches over the rows on screen, i.e. new lines and removed lines of the Diff.
const findOpen = ref(false)
const findText = ref('')
const findCase = ref(false)
const findWord = ref(false)
const findRegex = ref(false)
const findInput = ref<HTMLInputElement>()
const activeHit = ref(0)
const canFind = computed(() => props.file.kind === 'text' && !(isMarkdown.value && effectiveMode.value === 'file' && markdownMode.value === 'preview'))
const finder = computed(() => findPattern({ query: findText.value, caseSensitive: findCase.value, wholeWord: findWord.value, regex: findRegex.value }))
const findError = computed(() => finder.value.error)
const rawLines = computed(() => {
  const lines = content.value.split('\n').map(line => line.replace(/\r$/, ''))
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
})
const rowText = (row: DiffRow) => (row.kind === 'fold' ? '' : row.kind === 'deleted' ? row.text : rawLines.value[row.newLine - 1] ?? '')
const hits = computed<{ row: number; range: TextRange }[]>(() => {
  const pattern = findOpen.value && canFind.value ? finder.value.pattern : null
  if (!pattern) return []
  const result: { row: number; range: TextRange }[] = []
  rows.value.forEach((row, index) => {
    if (row.kind === 'fold') return
    for (const range of findInLine(rowText(row), pattern)) result.push({ row: index, range })
  })
  return result
})
const rowHits = computed(() => {
  const map = new Map<number, { ranges: TextRange[]; current: number }>()
  hits.value.forEach((hit, n) => {
    const entry = map.get(hit.row) ?? { ranges: [], current: -1 }
    if (n === activeHit.value) entry.current = entry.ranges.length
    entry.ranges.push(hit.range)
    map.set(hit.row, entry)
  })
  return map
})
function revealHit() {
  const hit = hits.value[activeHit.value]
  if (hit) scrollToRow(hit.row)
}
function stepFind(direction: 1 | -1) {
  if (!hits.value.length) return
  activeHit.value = (activeHit.value + direction + hits.value.length) % hits.value.length
  revealHit()
}
async function openFind() {
  if (!canFind.value) return
  findOpen.value = true
  await nextTick()
  findInput.value?.focus(); findInput.value?.select()
}
function closeFind() { findOpen.value = false }
// A new query or option restarts from the first match; content refreshes keep the position when possible.
watch([findText, findCase, findWord, findRegex, mode], () => { activeHit.value = 0; void nextTick(revealHit) })
watch(hits, list => { if (activeHit.value >= list.length) activeHit.value = 0 })

const widgetSet = computed(() => new Set([...props.widgetLines.map(l => 'new:' + l), ...props.oldWidgetLines.map(l => 'old:' + l)]))
/** Indexes of the rows that carry a widget underneath. */
const widgetOrder = computed(() => {
  const result: number[] = []
  if (widgetSet.value.size) rows.value.forEach((row, index) => { if (row.kind !== 'fold' && widgetSet.value.has(widgetKey(row))) result.push(index) })
  return result
})
const widgetHeightAt = (index: number) => widgetHeights.get(widgetKey(rows.value[index])) ?? WIDGET_ESTIMATE

const totalHeight = computed(() => rows.value.length * LINE_HEIGHT + widgetOrder.value.reduce((sum, i) => sum + widgetHeightAt(i), 0))

/** Index of the row under the vertical offset `y`, accounting for widgets above it. */
function indexAt(y: number): number {
  let extra = 0
  for (const row of widgetOrder.value) {
    const start = (row + 1) * LINE_HEIGHT + extra
    const height = widgetHeightAt(row)
    if (y < start) break
    if (y < start + height) return row
    extra += height
  }
  return Math.floor((y - extra) / LINE_HEIGHT)
}
const firstIndex = computed(() => Math.max(0, Math.min(rows.value.length - 1, indexAt(scrollTop.value) - OVERSCAN)))
const lastIndex = computed(() => Math.min(rows.value.length - 1, indexAt(scrollTop.value + viewHeight.value) + OVERSCAN))
const visible = computed(() => {
  const result: number[] = []
  for (let i = firstIndex.value; i <= lastIndex.value; i++) result.push(i)
  return result
})
const windowTop = computed(() => offsetOfIndex(firstIndex.value))

function offsetOfIndex(index: number): number {
  let top = index * LINE_HEIGHT
  for (const row of widgetOrder.value) if (row < index) top += widgetHeightAt(row)
  return top
}

function onScroll() { scrollTop.value = scroller.value?.scrollTop ?? 0 }

let resizeScroller: ResizeObserver | undefined
let resizeWidgets: ResizeObserver | undefined
const watched = new Map<HTMLElement, string>()
onMounted(() => {
  resizeWidgets = new ResizeObserver(entries => {
    for (const entry of entries) {
      const key = watched.get(entry.target as HTMLElement)
      if (key !== undefined) widgetHeights.set(key, Math.round(entry.target.getBoundingClientRect().height))
    }
  })
  resizeScroller = new ResizeObserver(() => { viewHeight.value = scroller.value?.clientHeight ?? viewHeight.value })
  if (scroller.value) resizeScroller.observe(scroller.value)
})
onBeforeUnmount(() => { resizeScroller?.disconnect(); resizeWidgets?.disconnect() })
// The scroller is replaced when switching between preview and source.
watch(scroller, (el, old) => {
  if (old) resizeScroller?.unobserve(old)
  if (el) { resizeScroller?.observe(el); viewHeight.value = el.clientHeight; scrollTop.value = el.scrollTop }
})

function watchWidget(el: HTMLElement | null, key: string) {
  if (!el || watched.get(el) === key) return
  watched.set(el, key)
  resizeWidgets?.observe(el)
  widgetHeights.set(key, Math.round(el.getBoundingClientRect().height))
}

// Selection by gutter: click, shift-click or drag, within one side.
const selection = ref<{ side: CodeSide; anchor: number; head: number } | null>(null)
let dragging = false
const selectionSide = (row: DiffRow): CodeSide => (effectiveMode.value === 'file' ? props.side : sideOf(row))
function isSelected(row: DiffRow): boolean {
  const current = selection.value
  if (!current || row.kind === 'fold' || selectionSide(row) !== current.side) return false
  const line = lineOf(row)
  return line >= Math.min(current.anchor, current.head) && line <= Math.max(current.anchor, current.head)
}
function startSelect(row: DiffRow, event: MouseEvent) {
  if (row.kind === 'fold') return
  const line = lineOf(row)
  const side = selectionSide(row)
  const anchor = event.shiftKey && selection.value?.side === side ? selection.value.anchor : line
  selection.value = { side, anchor, head: line }
  dragging = true
  window.addEventListener('mouseup', finishSelect, { once: true })
}
function extendSelect(row: DiffRow) {
  if (!dragging || !selection.value || row.kind === 'fold') return
  if (selectionSide(row) === selection.value.side) selection.value = { ...selection.value, head: lineOf(row) }
}
function finishSelect() {
  dragging = false
  const current = selection.value
  if (!current) return
  emit('select', { path: props.file.path, side: current.side, startLine: Math.min(current.anchor, current.head), endLine: Math.max(current.anchor, current.head) })
}
function clearSelection() { selection.value = null }

function expandFold(start: number) { expanded.add(start) }

function scrollToRow(index: number) {
  if (!scroller.value) return
  scroller.value.scrollTop = Math.max(0, offsetOfIndex(Math.max(0, Math.min(rows.value.length - 1, index))) - viewHeight.value / 3)
  onScroll()
}

async function scrollToLine(line: number, side: CodeSide = 'new') {
  const find = () => rows.value.findIndex(row => row.kind !== 'fold' && lineOf(row) === line && (effectiveMode.value === 'file' || sideOf(row) === side))
  let index = find()
  if (index < 0) {
    const fold = rows.value.find(row => row.kind === 'fold' && line >= row.start && line < row.start + row.count)
    if (fold?.kind === 'fold') { expanded.add(fold.start); await nextTick(); index = find() }
  }
  if (index >= 0) scrollToRow(index)
}

function step(direction: 1 | -1) {
  const total = blockRows.value.length
  if (!total) return
  const next = currentBlock.value < 0 ? (direction === 1 ? 0 : total - 1) : (currentBlock.value + direction + total) % total
  currentBlock.value = next
  scrollToRow(blockRows.value[next])
}

watch(() => props.file.path, () => {
  selection.value = null
  widgetHeights.clear()
  watched.clear()
  expanded.clear()
  expandAll.value = false
  currentBlock.value = -1
  scrollTop.value = 0
  if (scroller.value) scroller.value.scrollTop = 0
})
watch(() => props.hunks, () => { currentBlock.value = -1; expanded.clear() })
watch(() => props.file.content, () => deletedHtml.clear())
watch(mode, () => { currentBlock.value = -1; scrollTop.value = 0; if (scroller.value) scroller.value.scrollTop = 0 })

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ'
}

defineExpose({ scrollToLine, clearSelection, step, openFind })
</script>

<style scoped>
.code-view {
  --hl-text: #e6edf3; --hl-keyword: #ff7b72; --hl-title: #d2a8ff; --hl-attr: #79c0ff; --hl-string: #a5d6ff;
  --hl-comment: #8b949e; --hl-built-in: #ffa657; --hl-name: #7ee787; --hl-meta: #79c0ff; --hl-addition: #aff5b4; --hl-deletion: #ffdcd7;
  /* Changed lines: a tinted line, a stronger tint under the numbers and a coloured edge, as in GitHub. */
  --cv-add: #3fb950; --cv-add-line: rgba(46, 160, 67, 0.22); --cv-add-gutter: rgba(63, 185, 80, 0.38);
  --cv-del: #f85149; --cv-del-line: rgba(248, 81, 73, 0.2); --cv-del-gutter: rgba(248, 81, 73, 0.38);
  /* Marker slot, then one column per number side; `ch` resolves in the monospace gutter. */
  --gutter: calc(18px + var(--cols, 1) * (var(--digits, 3) * 1ch + 8px) + 6px);
  display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; background: var(--bg);
}
:global(:root[data-theme='light']) .code-view {
  --hl-text: #24292f; --hl-keyword: #cf222e; --hl-title: #8250df; --hl-attr: #0550ae; --hl-string: #0a3069;
  --hl-comment: #6e7781; --hl-built-in: #953800; --hl-name: #116329; --hl-meta: #0550ae; --hl-addition: #116329; --hl-deletion: #82071e;
  --cv-add: #1a7f37; --cv-add-line: rgba(26, 127, 55, 0.13); --cv-add-gutter: rgba(26, 127, 55, 0.28);
  --cv-del: #cf222e; --cv-del-line: rgba(207, 34, 46, 0.11); --cv-del-gutter: rgba(207, 34, 46, 0.25);
}
.cv-header { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 34px; padding: 4px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.cv-icon { display: inline-flex; flex-shrink: 0; }
.cv-icon :deep(svg) { width: 16px; height: 16px; }
.cv-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text); }
.cv-toggle { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.cv-toggle button { padding: 2px 10px; font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.cv-toggle button:focus-visible, .cv-nav button:focus-visible, .cv-link:focus-visible, .cv-fold-button:focus-visible, .cv-find-opt:focus-visible, .cv-find-input:focus-visible { outline: 2px solid var(--blue); outline-offset: -1px; }
.cv-toggle button:hover { color: var(--text); }
.cv-toggle button.on { background: var(--bg3); color: var(--text); }
.cv-note { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--text-muted); font-size: 13px; }
.cv-image { overflow: auto; background: repeating-conic-gradient(var(--bg2) 0% 25%, var(--bg) 0% 50%) 0 / 16px 16px; }
.cv-image img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cv-preview { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px; }
.cv-scroll { flex: 1; min-height: 0; overflow: auto; container-type: inline-size; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; }
.cv-body { position: relative; min-width: 100%; }
.cv-window { position: absolute; top: 0; left: 0; min-width: 100%; width: max-content; }
.cv-line { display: flex; height: 20px; line-height: 20px; }
.cv-line.selected { background: var(--blue-soft); }
.cv-line.added { background: var(--cv-add-line); }
.cv-line.deleted { background: var(--cv-del-line); }
.cv-line.added.selected, .cv-line.deleted.selected { background: var(--blue-soft); }
/* The gutter is sticky over scrolled code, so its tint is laid over an opaque background. */
.cv-line.added .cv-gutter { background: linear-gradient(var(--cv-add-gutter), var(--cv-add-gutter)), var(--bg); box-shadow: inset 3px 0 0 var(--cv-add); color: var(--text); }
.cv-line.deleted .cv-gutter { background: linear-gradient(var(--cv-del-gutter), var(--cv-del-gutter)), var(--bg); box-shadow: inset 3px 0 0 var(--cv-del); color: var(--text); }
.cv-line.added .cv-sign { color: var(--cv-add); font-weight: 700; }
.cv-line.deleted .cv-sign { color: var(--cv-del); font-weight: 700; }
.cv-fold { background: var(--bg2); }
.cv-fold-button { position: sticky; left: var(--gutter, 64px); flex: 1; padding: 0 8px; text-align: left; font-size: 12px; line-height: 20px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.cv-fold-button:hover { color: var(--text); }
.cv-sign { flex-shrink: 0; width: 14px; text-align: center; color: var(--text-muted); user-select: none; }
.cv-old { color: var(--text-faint); }
.cv-stats { font-size: 12px; white-space: nowrap; }
.cv-plus { color: var(--diff-add, #3fb950); }
.cv-minus { color: var(--diff-del, #f85149); }
.cv-rename { display: inline-block; padding: 0 4px; border-radius: 3px; background: var(--bg3); color: var(--text-muted); font-size: 11px; }
.cv-nav { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); }
.cv-nav button, .cv-link { padding: 0 6px; font-size: 12px; color: var(--text-muted); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.cv-nav button:hover, .cv-link:hover { color: var(--text); }
.cv-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); white-space: nowrap; cursor: pointer; }
.stripe-added { box-shadow: inset 3px 0 0 var(--diff-add, #3fb950); }
.stripe-modified { box-shadow: inset 3px 0 0 var(--diff-mod, #388bfd); }
.stripe-deleted { position: relative; }
.stripe-deleted::before { content: ''; position: absolute; left: 0; top: 0; border-left: 6px solid var(--diff-del, #f85149); border-top: 4px solid transparent; border-bottom: 4px solid transparent; }
.cv-find { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 4px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.cv-find-input { flex: 1; min-width: 80px; max-width: 320px; padding: 2px 8px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.cv-find-input.invalid { border-color: var(--danger-hover); }
.cv-find-opt { min-width: 22px; padding: 0 5px; font-size: 12px; color: var(--text-muted); background: none; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
.cv-find-opt:hover:not(:disabled) { color: var(--text); border-color: var(--border-strong); }
.cv-find-opt.on { color: var(--text); background: var(--blue-soft); border-color: var(--blue); }
.cv-find-opt:disabled { opacity: 0.4; cursor: default; }
.cv-find-count { min-width: 70px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.cv-text :deep(mark.cv-hit) { color: inherit; background: rgba(255, 196, 0, 0.35); border-radius: 2px; }
.cv-text :deep(mark.cv-hit-current) { background: rgba(255, 140, 0, 0.7); outline: 1px solid rgba(255, 140, 0, 0.9); }
.cv-line:hover .cv-number { color: var(--text); }
.cv-gutter {
  position: sticky; left: 0; z-index: 1; display: flex; align-items: center; justify-content: flex-end; gap: 2px;
  box-sizing: border-box; flex-shrink: 0; width: var(--gutter); padding-right: 6px; background: var(--bg); color: var(--text-faint); cursor: pointer; user-select: none;
}
.cv-line.selected .cv-gutter { background: var(--bg2); }
.cv-number { flex-shrink: 0; width: calc(var(--digits, 3) * 1ch); margin-left: 8px; text-align: right; }
.cv-marker { padding: 0; font-size: 11px; line-height: 1; background: none; border: none; cursor: pointer; }
.cv-marker sup { font-size: 9px; color: var(--text-muted); }
.cv-text { flex: 1; padding-left: 8px; padding-right: 16px; white-space: pre; background: none; color: var(--hl-text); font-family: inherit; font-size: inherit; }
/* Comments under a line start at the left edge: they belong to the review, not to the code's indentation. */
.cv-widget { position: sticky; left: 0; box-sizing: border-box; width: min(760px, 100cqw); padding: 4px 12px 4px 8px; font-family: var(--font, sans-serif); white-space: normal; }
.cv-text :deep(.hljs-keyword), .cv-text :deep(.hljs-doctag), .cv-text :deep(.hljs-template-tag), .cv-text :deep(.hljs-template-variable), .cv-text :deep(.hljs-type) { color: var(--hl-keyword); }
.cv-text :deep(.hljs-title) { color: var(--hl-title); }
.cv-text :deep(.hljs-attr), .cv-text :deep(.hljs-attribute), .cv-text :deep(.hljs-literal), .cv-text :deep(.hljs-number), .cv-text :deep(.hljs-operator),
.cv-text :deep(.hljs-variable), .cv-text :deep(.hljs-selector-attr), .cv-text :deep(.hljs-selector-class), .cv-text :deep(.hljs-selector-id) { color: var(--hl-attr); }
.cv-text :deep(.hljs-string), .cv-text :deep(.hljs-regexp) { color: var(--hl-string); }
.cv-text :deep(.hljs-comment), .cv-text :deep(.hljs-quote) { color: var(--hl-comment); }
.cv-text :deep(.hljs-built_in), .cv-text :deep(.hljs-symbol), .cv-text :deep(.hljs-bullet) { color: var(--hl-built-in); }
.cv-text :deep(.hljs-name), .cv-text :deep(.hljs-tag), .cv-text :deep(.hljs-selector-tag) { color: var(--hl-name); }
.cv-text :deep(.hljs-meta) { color: var(--hl-meta); }
.cv-text :deep(.hljs-addition) { color: var(--hl-addition); }
.cv-text :deep(.hljs-deletion) { color: var(--hl-deletion); }
</style>
