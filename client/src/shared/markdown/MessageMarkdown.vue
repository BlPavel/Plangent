<template>
  <div ref="host" class="md" :class="{ 'md-typing': live || catching }" v-html="html" @click="openDocument" />
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { DocumentLinksKey } from './documentLinks'
import { useSmoothText } from './useSmoothText'
import { useMermaid } from './useMermaid'
import { renderMarkdown } from './markdown'

/** Markdown message body; text that grows after mount is typed out smoothly. */
const props = defineProps<{ text: string; live?: boolean }>()
const { shown, catching } = useSmoothText(() => props.text)
const links = inject(DocumentLinksKey, undefined)
const html = computed(() => renderMarkdown(shown.value, links))
// Diagrams are drawn once the text stops growing: a half-typed diagram is a syntax error.
const host = ref<HTMLElement>()
useMermaid(host, () => html.value, () => !props.live && !catching.value)
function openDocument(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-document-target]')
  const target = button?.dataset.documentTarget
  if (target && links?.exists(target)) links.open(target)
}
</script>

<style scoped>
.md { font-size: var(--fs-base); line-height: var(--lh-prose); color: var(--text); overflow-wrap: anywhere; }
.md :deep(> *:first-child) { margin-top: 0; }
.md :deep(> *:last-child) { margin-bottom: 0; }
.md :deep(p), .md :deep(ul), .md :deep(ol), .md :deep(pre), .md :deep(blockquote), .md :deep(table) { margin: 0 0 12px; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { margin: 18px 0 8px; font-weight: var(--fw-semibold); line-height: var(--lh-heading); }
.md :deep(h1) { font-size: var(--fs-2xl); }
.md :deep(h2) { font-size: var(--fs-xl); }
.md :deep(h3) { font-size: var(--fs-lg); }
.md :deep(h4) { font-size: var(--fs-base); }
.md :deep(ul), .md :deep(ol) { padding-left: 22px; }
.md :deep(li) { margin: 3px 0; }
.md :deep(li > p) { margin: 0; }
.md :deep(a) { color: var(--blue-hover); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }
.md :deep(blockquote) { padding: 2px 12px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.md :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg3);
  border: 1px solid var(--border);
}
.md :deep(pre) {
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg2);
  border: 1px solid var(--border);
  overflow-x: auto;
  line-height: var(--lh-normal);
}
.md :deep(pre code) { padding: 0; border: none; background: none; font-size: var(--fs-md); }
.md :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; font-size: var(--fs-md); }
/* `anywhere` on .md would shrink columns to one letter; words break only in code (paths), where nothing else fits. */
.md :deep(th), .md :deep(td) { padding: 6px 10px; border: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: break-word; }
.md :deep(td code) { overflow-wrap: anywhere; }
.md :deep(th:first-child), .md :deep(td:first-child) { min-width: 140px; }
.md :deep(th) { background: var(--bg2); font-weight: var(--fw-semibold); }

/* Mermaid: a diagram replaces its source; a broken one keeps the source with the message.
   Labels are measured outside .md, so its word breaking must not reach them or long names get clipped. */
.md :deep(.mermaid-block) { margin: 0 0 12px; overflow-wrap: normal; }
.md :deep(.mermaid-block[data-mermaid='done']) { display: flex; justify-content: center; overflow-x: auto; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.md :deep(.mermaid-block svg) { max-width: 100%; height: auto; }
.md :deep(.mermaid-block pre) { margin: 0; }
.md :deep(.mermaid-error) { margin: 6px 0 0; font-size: var(--fs-md); color: var(--danger); }

/* Blinking caret after the last block while the answer is being typed */
.md-typing :deep(> *:last-child::after) {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1.05em;
  margin-left: 3px;
  vertical-align: text-bottom;
  border-radius: var(--radius-xs);
  background: var(--text-muted);
  animation: caret var(--motion-blink) steps(2, start) infinite;
}
.md-typing :deep(> pre:last-child::after), .md-typing :deep(> ul:last-child::after), .md-typing :deep(> ol:last-child::after) { display: none; }
@keyframes caret { to { visibility: hidden; } }
.md :deep(.document-link) { display: inline; border: 0; border-radius: var(--radius-xs); background: var(--blue-soft); color: var(--blue-hover); padding: 1px var(--sp-1); font: inherit; cursor: pointer; }
.md :deep(.document-link:hover:not(:disabled)) { text-decoration: underline; }
.md :deep(.document-link:disabled) { color: var(--text-faint); cursor: not-allowed; }
.md :deep(.document-link:focus-visible) { outline: var(--focus-outline); }
</style>
