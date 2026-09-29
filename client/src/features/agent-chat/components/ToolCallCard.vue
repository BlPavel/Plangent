<template>
  <div class="tool" :class="[state, { open }]">
    <button type="button" class="tool-head" :disabled="!hasBody" @click="open = !open">
      <svg class="tool-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path v-for="(d, i) in icon" :key="i" :d="d" /></svg>
      <span class="tool-title">{{ call.title || 'Инструмент' }}</span>
      <span v-if="state === 'running'" class="tool-spinner" />
      <span v-else-if="state === 'failed'" class="tool-state">ошибка</span>
      <svg v-if="hasBody" class="tool-chevron" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <div v-if="open" class="tool-body">
      <template v-for="(part, index) in call.content" :key="index">
        <div v-if="part.type === 'diff'" class="diff">
          <div class="diff-path">{{ part.path }}</div>
          <pre><span v-for="(line, i) in diffLines(part.oldText ?? '', part.newText ?? '')" :key="i" :class="line.kind">{{ line.text }}</span></pre>
        </div>
        <pre v-else-if="part.content?.text">{{ part.content.text }}</pre>
      </template>
      <pre v-if="output">{{ output }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatPayload } from '../stores/sessions'

const props = defineProps<{ call: ChatPayload }>()
const open = ref(false)

const state = computed(() => {
  const s = props.call.status
  return s === 'failed' ? 'failed' : s === 'completed' ? 'done' : 'running'
})
const output = computed(() => {
  const raw = props.call.rawOutput
  if (raw == null || raw === '') return ''
  if (props.call.content?.some(p => p.type === 'diff' || p.content?.text)) return ''
  return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
})
const hasBody = computed(() => !!output.value || !!props.call.content?.some(p => p.type === 'diff' || p.content?.text))

const ICONS: Record<string, string[]> = {
  read: ['M4 2.5h5l3 3v8H4z M9 2.5v3h3'],
  edit: ['M10.5 3l2.5 2.5L6 12.5H3.5V10z'],
  delete: ['M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5'],
  move: ['M3 8h9M9 5l3 3-3 3'],
  search: ['M3.2 7a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0','M10 10l3 3'],
  execute: ['M3 4l4 4-4 4M8.5 12H13'],
  think: ['M8 2.5a4 4 0 0 0-2.5 7.1V11h5V9.6A4 4 0 0 0 8 2.5zM6 13.5h4'],
  fetch: ['M2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0','M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11'],
  other: ['M3 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0','M7 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0','M11 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
}
const icon = computed(() => ICONS[String(props.call.kind)] ?? ICONS.other)

/** Compact diff: common leading/trailing lines collapse to a little context. */
function diffLines(oldText: string, newText: string) {
  const a = oldText ? oldText.split('\n') : [], b = newText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const ctx = 2
  return [
    ...a.slice(Math.max(0, start - ctx), start).map(text => ({ kind: 'ctx', text: '  ' + text })),
    ...a.slice(start, endA).map(text => ({ kind: 'del', text: '- ' + text })),
    ...b.slice(start, endB).map(text => ({ kind: 'add', text: '+ ' + text })),
    ...a.slice(endA, endA + ctx).map(text => ({ kind: 'ctx', text: '  ' + text })),
  ]
}
</script>

<style scoped>
.tool { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); overflow: hidden; }
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  background: none;
  border: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.tool-head:disabled { cursor: default; }
.tool-head:not(:disabled):hover { color: var(--text); background: var(--bg3); }
.tool-icon { width: 14px; height: 14px; flex-shrink: 0; }
.tool-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; }
.tool.done .tool-icon { color: var(--accent-hover); }
.tool.failed { border-color: var(--danger-soft); }
.tool.failed .tool-icon, .tool-state { color: var(--danger-hover); }
.tool-state { font-size: 11px; }
.tool-chevron { width: 13px; height: 13px; flex-shrink: 0; transition: transform 0.15s; }
.tool.open .tool-chevron { transform: rotate(90deg); }
.tool-spinner { width: 12px; height: 12px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-top-color: var(--blue-hover); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.tool-body { border-top: 1px solid var(--border); max-height: 360px; overflow: auto; }
.tool-body pre { margin: 0; padding: 10px 12px; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); }
.tool-body pre + pre, .diff + pre, .diff + .diff { border-top: 1px solid var(--border); }
.diff-path { padding: 6px 12px; font-size: 11.5px; color: var(--text-muted); background: var(--bg3); font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; }
.diff pre { padding: 6px 0; }
.diff span { display: block; padding: 0 12px; }
.diff .del { background: var(--danger-soft); color: #ffa198; }
.diff .add { background: var(--accent-soft); color: #7ee787; }
.diff .ctx { color: var(--text-faint); }
</style>
