<template>
  <details class="guide">
    <summary>Как настроить</summary>
    <!-- Trusted bundled Markdown; embedded HTML is disabled. -->
    <article class="guide-content" v-html="html" />
  </details>
</template>
<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import guide from '../../../../docs/CONNECTIONS-USER-GUIDE.md?raw'
const html = new MarkdownIt({ html: false }).render(guide)
</script>
<style scoped>
.guide { font-size: 13px; color: var(--text); }
.guide > summary { cursor: pointer; color: var(--blue-hover); width: fit-content; }
.guide-content { max-height: 55vh; overflow: auto; padding: 12px; margin-top: 8px; background: var(--bg3); border-radius: var(--radius-sm); line-height: 1.6; }
.guide-content :deep(h1), .guide-content :deep(h2), .guide-content :deep(h3) { margin: 16px 0 8px; line-height: 1.3; }
.guide-content :deep(p), .guide-content :deep(ul), .guide-content :deep(ol) { margin: 8px 0; }
.guide-content :deep(ul), .guide-content :deep(ol) { padding-left: 24px; }
.guide-content :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; }
.guide-content :deep(th), .guide-content :deep(td) { border: 1px solid var(--border); padding: 6px; text-align: left; vertical-align: top; }
.guide-content :deep(pre) { overflow-x: auto; padding: 10px; background: var(--bg2); }
.guide-content :deep(code) { font-size: 12px; }
</style>
