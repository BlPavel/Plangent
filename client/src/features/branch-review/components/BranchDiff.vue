<template>
  <div class="branch-diff">
    <p v-if="error" role="alert" class="state error">Не удалось загрузить файл: {{ error }}</p>
    <p v-else-if="file.binary" class="state">Бинарный файл — текстового diff нет.</p>
    <p v-else-if="!ready" class="state">Загрузка…</p>
    <p v-else-if="!hunks.length" class="state">Нет текстового diff. Изменились только права или режим файла.</p>
    <CodeView
      v-else v-model:mode="mode" :file="viewer" :hunks="hunks" :original-path="file.old_path"
      :markers="markers('new')" :old-markers="markers('old')" :widget-lines="lines('new')" :old-widget-lines="lines('old')"
      @select="$emit('select', $event)" @marker-click="(line, side) => $emit('select', { path: file.path, side, startLine: line, endLine: line })"
    >
      <template #widget="{ line, side }">
        <slot v-if="selection?.side === side && selection.startLine === line" name="composer" />
      </template>
    </CodeView>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { CodeView, parseUnifiedDiff, type LineSelection, type CodeSide } from '@shared/code-viewer'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { ReviewFile } from '../types'

const props = defineProps<{ scope: string; reviewId: string; head: string; file: ReviewFile; selection: LineSelection | null }>()
defineEmits<{ select: [selection: LineSelection] }>()
const mode = ref<'file' | 'diff'>('diff'), diff = ref(''), content = ref(''), error = ref(''), ready = ref(false)
const hunks = computed(() => parseUnifiedDiff(diff.value))
const viewer = computed(() => ({ path: props.file.path, kind: 'text' as const, size: content.value.length, content: content.value }))
let controller: AbortController | undefined
watch(() => [props.scope, props.reviewId, props.head, props.file.path, props.file.sig], async () => {
  controller?.abort()
  const mine = controller = new AbortController()
  ready.value = false
  error.value = ''
  if (props.file.binary) { ready.value = true; return }
  try {
    const [d, f] = await Promise.all([
      branchReviewApi.diff(props.scope, props.reviewId, props.file.path, mine.signal),
      props.file.status === 'D' ? Promise.resolve({ content: '' }) : branchReviewApi.file(props.scope, props.reviewId, props.file.path, mine.signal),
    ])
    if (mine.signal.aborted) return
    diff.value = d.diff
    content.value = f.content
    ready.value = true
  } catch (cause) { if (!mine.signal.aborted) error.value = errorText(cause) }
}, { immediate: true })
onBeforeUnmount(() => controller?.abort())
const lines = (side: CodeSide) => props.selection?.side === side ? [props.selection.startLine] : []
const markers = (side: CodeSide) => lines(side).map(line => ({ line, title: 'Выбранная строка' }))
</script>
<style scoped>
.branch-diff { height: 100%; display: flex; flex-direction: column; min-height: 360px; }
.branch-diff :deep(.code-view) { flex: 1; min-height: 320px; }
.state { padding: 24px; text-align: center; font-size: 12.5px; color: var(--text-muted); }
.state.error { color: var(--danger-hover); }
</style>
