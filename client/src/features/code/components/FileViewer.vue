<template>
  <div class="fv">
    <div v-if="!path" class="fv-empty">
      <div class="fv-empty-title">Файл не выбран</div>
      <div class="fv-empty-text">Выберите файл слева. <kbd>Ctrl</kbd>+<kbd>P</kbd> — перейти к файлу, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> — поиск по проекту.</div>
    </div>
    <div v-else-if="!viewerFile" class="fv-empty">{{ loadError ?? 'Загрузка…' }}</div>
    <CodeView
      v-else
      ref="view" v-model:mode="mode" v-model:ignore-whitespace="ignoreWhitespace"
      :file="viewerFile" :side="'new'" :hunks="hunks" :original-path="change?.originalPath"
      :image-src="viewerFile.kind === 'image' ? codeApi.imageUrl(projectId, viewerFile.path) + '&v=' + store.file?.size : undefined"
      :markers="markers" :old-markers="oldMarkers" :widget-lines="widgetLines" :old-widget-lines="oldWidgetLines"
      @select="emit('select', $event)" @marker-click="(line, side) => emit('marker-click', line, side)"
    >
      <template #header="{ path: headerPath }"><slot name="header" :path="headerPath" :change="change" /></template>
      <template #widget="slotProps"><slot name="widget" v-bind="slotProps" /></template>
      <template #notes="{ path: notesPath }"><slot name="notes" :path="notesPath" /></template>
    </CodeView>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CodeView, parseUnifiedDiff, type CodeSide, type DiffHunk, type LineMarker, type LineSelection, type ViewerFile } from '@shared/code-viewer'
import { codeApi } from '../api'
import { useCodeStore } from '../stores/code'

const props = withDefaults(defineProps<{
  projectId: string
  markers?: LineMarker[]
  oldMarkers?: LineMarker[]
  widgetLines?: number[]
  oldWidgetLines?: number[]
}>(), { markers: () => [], oldMarkers: () => [], widgetLines: () => [], oldWidgetLines: () => [] })
const emit = defineEmits<{ select: [selection: LineSelection]; 'marker-click': [line: number, side: CodeSide] }>()
defineSlots<{
  header?(props: { path: string; change?: { originalPath?: string; status: string } }): unknown
  widget?(props: { line: number; side: CodeSide; path: string }): unknown
  notes?(props: { path: string }): unknown
}>()
const mode = defineModel<'diff' | 'file'>('mode', { default: 'file' })

const store = useCodeStore()
const view = ref<InstanceType<typeof CodeView>>()
const hunks = ref<DiffHunk[] | undefined>()
const loadError = ref<string | null>(null)
const ignoreWhitespace = ref(false)

const path = computed(() => store.selectedPath)
const change = computed(() => store.shownChanges.find(c => c.path === path.value))

// «Всё, что вошло в ревью» shows the file as it was at the end of the review, not as it is on disk now.
const atEnd = ref<{ path: string; end: string; content: string } | null>(null)
let endRequest: AbortController | undefined
async function loadAtEnd() {
  endRequest?.abort()
  const target = path.value
  const end = store.diffEnds?.end
  if (store.effectiveBase !== 'review' || !target || !end) { atEnd.value = null; return }
  if (atEnd.value?.path === target && atEnd.value.end === end) return
  const mine = endRequest = new AbortController()
  try {
    const { content } = await codeApi.oldFile(props.projectId, target, end, mine.signal)
    if (!mine.signal.aborted) atEnd.value = { path: target, end, content }
  } catch {
    // Absent at the end of the review (deleted): the Diff shows the removed lines against an empty file.
    if (!mine.signal.aborted) atEnd.value = { path: target, end, content: '' }
  }
}
watch([path, () => store.effectiveBase, () => store.diffEnds?.end], () => { void loadAtEnd() }, { immediate: true })

/** A deleted file is gone from disk; it is shown as an empty file with the removed lines in the Diff. */
const viewerFile = computed<ViewerFile | null>(() => {
  if (store.effectiveBase === 'review' && path.value) {
    if (store.shownStats[path.value]?.binary) return { path: path.value, size: 0, kind: 'binary' }
    const found = atEnd.value
    return found && found.path === path.value && found.end === store.diffEnds?.end ? { path: path.value, size: found.content.length, kind: 'text', content: found.content } : null
  }
  if (store.file && store.file.path === path.value) return store.file
  if (path.value && change.value?.status === 'D') return { path: path.value, size: 0, kind: 'text', content: '' }
  return null
})

let controller: AbortController | undefined
async function loadDiff() {
  controller?.abort()
  const target = path.value
  const current = change.value
  if (!target || !current) { hunks.value = undefined; return }
  const mine = controller = new AbortController()
  try {
    const ends = store.diffEnds
    const { diff } = await store.diff(target, { originalPath: current.originalPath, ignoreWhitespace: ignoreWhitespace.value, ...(ends ?? {}) }, mine.signal)
    if (!mine.signal.aborted) hunks.value = parseUnifiedDiff(diff)
  } catch {
    // The file stays viewable without its diff; a failed refresh keeps the last hunks.
    if (!mine.signal.aborted && !hunks.value) hunks.value = undefined
  }
}
// Switching files drops the old hunks at once so they never render against another file's content.
watch(path, () => { hunks.value = undefined; loadError.value = null })
watch([path, () => change.value?.status, () => change.value?.originalPath, () => store.file, () => store.diffEnds?.base, () => store.diffEnds?.end, ignoreWhitespace], () => { void loadDiff() }, { immediate: true })
watch(() => store.error, error => { loadError.value = error })

async function scrollToLine(line: number, side: CodeSide = 'new') {
  await nextTick()
  await view.value?.scrollToLine(line, side)
}
defineExpose({
  scrollToLine,
  openFind: () => view.value?.openFind(),
  clearSelection: () => view.value?.clearSelection(),
})
</script>

<style scoped>
.fv { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.fv > :deep(.code-view) { flex: 1; }
.fv-empty { margin: auto; max-width: 360px; padding: 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.fv-empty-title { margin-bottom: 6px; font-size: 15px; font-weight: 600; color: var(--text); }
kbd { font-family: inherit; font-size: 11px; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg3); }
</style>
