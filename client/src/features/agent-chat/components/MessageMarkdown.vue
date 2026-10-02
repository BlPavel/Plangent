<template>
  <div class="md" :class="{ 'md-typing': live || catching }" v-html="html" @click="openDocument" />
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { DocumentLinksKey } from '@shared/composables/documentLinks'
import { useSmoothText } from '@shared/composables/useSmoothText'
import { renderMarkdown } from '../utils/markdown'

/** Markdown message body; text that grows after mount is typed out smoothly. */
const props = defineProps<{ text: string; live?: boolean }>()
const { shown, catching } = useSmoothText(() => props.text)
const links = inject(DocumentLinksKey, undefined)
const html = computed(() => renderMarkdown(shown.value, links))
function openDocument(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-analysis-target]')
  const target = button?.dataset.analysisTarget
  if (target && links?.exists(target)) links.open(target)
}
</script>

<style scoped>
.md { font-size: 14px; line-height: 1.65; color: var(--text); overflow-wrap: anywhere; }
.md :deep(> *:first-child) { margin-top: 0; }
.md :deep(> *:last-child) { margin-bottom: 0; }
.md :deep(p), .md :deep(ul), .md :deep(ol), .md :deep(pre), .md :deep(blockquote), .md :deep(table) { margin: 0 0 12px; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { margin: 18px 0 8px; font-weight: 600; line-height: 1.3; }
.md :deep(h1) { font-size: 20px; }
.md :deep(h2) { font-size: 17px; }
.md :deep(h3) { font-size: 15px; }
.md :deep(h4) { font-size: 14px; }
.md :deep(ul), .md :deep(ol) { padding-left: 22px; }
.md :deep(li) { margin: 3px 0; }
.md :deep(li > p) { margin: 0; }
.md :deep(a) { color: var(--blue-hover); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }
.md :deep(blockquote) { padding: 2px 12px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.md :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.md :deep(code) {
  font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg3);
  border: 1px solid var(--border);
}
.md :deep(pre) {
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg2);
  border: 1px solid var(--border);
  overflow-x: auto;
  line-height: 1.5;
}
.md :deep(pre code) { padding: 0; border: none; background: none; font-size: 12.5px; }
.md :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; font-size: 13px; }
.md :deep(th), .md :deep(td) { padding: 6px 10px; border: 1px solid var(--border); text-align: left; }
.md :deep(th) { background: var(--bg2); font-weight: 600; }

/* Blinking caret after the last block while the answer is being typed */
.md-typing :deep(> *:last-child::after) {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1.05em;
  margin-left: 3px;
  vertical-align: text-bottom;
  border-radius: 2px;
  background: var(--text-muted);
  animation: caret 1s steps(2, start) infinite;
}
.md-typing :deep(> pre:last-child::after), .md-typing :deep(> ul:last-child::after), .md-typing :deep(> ol:last-child::after) { display: none; }
@keyframes caret { to { visibility: hidden; } }
</style>
