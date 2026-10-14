<template>
  <div class="commit-diff"><span v-if="error" role="alert">{{ error }}</span>
    <CodeView v-else-if="file" v-model:mode="mode" :file="file" :hunks="hunks" :original-path="originalPath" />
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { CodeView, parseUnifiedDiff, type ViewerFile, type DiffHunk } from '@shared/code-viewer'
import { codeApi } from '../api'
const props = defineProps<{ projectId: string; path: string; base: string; end: string; originalPath?: string; binary?: boolean; deleted?: boolean }>()
const file = ref<ViewerFile>(), hunks = ref<DiffHunk[]>(), error = ref(''), mode = ref<'diff' | 'file'>('diff')
let controller: AbortController | undefined
watch(() => [props.projectId, props.path, props.base, props.end, props.originalPath, props.binary, props.deleted], async () => {
 controller?.abort(); const mine = controller = new AbortController(); file.value = undefined; error.value = ''
 try {
  const [content, diff] = await Promise.all([
   props.binary || props.deleted ? Promise.resolve('') : codeApi.oldFile(props.projectId, props.path, props.end, mine.signal).then(r => r.content).catch(cause => { if (mine.signal.aborted) throw cause; if (/not found|does not exist|exists on disk|not in/i.test(String(cause))) return ''; throw cause }),
   codeApi.diff(props.projectId, props.path, { base: props.base, end: props.end, originalPath: props.originalPath }, mine.signal),
  ])
  if (!mine.signal.aborted) { file.value = { path: props.path, kind: props.binary ? 'binary' : 'text', size: content.length, content }; hunks.value = parseUnifiedDiff(diff.diff) }
 } catch (cause) { if (!mine.signal.aborted) error.value = String(cause) }
}, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>
<style scoped>.commit-diff { height: 420px; min-width: 0; display: flex; flex-direction: column; } .commit-diff :deep(.code-view) { flex: 1; }</style>
