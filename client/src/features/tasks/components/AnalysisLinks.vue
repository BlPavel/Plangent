<template>
  <template v-for="(part, i) in parts" :key="i">
    <button
      v-if="part.target" type="button" class="analysis-link" :class="{ broken: !part.valid, file: part.target.includes('/') }" :disabled="!part.valid"
      :title="part.valid ? (part.target.includes('/') ? 'Открыть файл анализа' : 'Открыть раздел анализа') : 'Раздел или файл не найден в анализе'"
      @click="navigation?.open(part.target)"
    >
      <svg v-if="part.target.includes('/')" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 5.5L6.2 9.8a1.2 1.2 0 001.7 1.7l4.6-4.6a2.4 2.4 0 00-3.4-3.4L4.5 8.1a3.6 3.6 0 005.1 5.1l3.9-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <svg v-else viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 2.5h5.5L12 5v8.5H4z M6 7.5h4M6 10h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" /></svg>
      {{ part.target }}
    </button>
    <span v-else>{{ part.text }}</span>
  </template>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { AnalysisNavigationKey } from '../composables/analysisNavigation'
const props = defineProps<{ text: string }>()
const navigation = inject(AnalysisNavigationKey)
const parts = computed(() => {
  const result: { text?: string; target?: string; valid?: boolean }[] = []
  let cursor = 0
  for (const m of props.text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    result.push({ text: props.text.slice(cursor, m.index) })
    const [slug, ...names] = m[1].split('/')
    const section = navigation?.sections.value.find(s => s.slug === slug)
    result.push({ target: m[1], valid: !!section && (!names.length || section.files.some(f => f.name === names.join('/'))) })
    cursor = m.index! + m[0].length
  }
  result.push({ text: props.text.slice(cursor) })
  return result
})
</script>
<style scoped>
.analysis-link { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; margin: 0 1px; padding: 0 6px; height: 19px; vertical-align: 1px; border: 1px solid var(--blue-soft); border-radius: 5px; background: var(--blue-soft); color: var(--blue-hover); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: border-color 0.12s, background 0.12s; }
.analysis-link svg { width: 11px; height: 11px; flex-shrink: 0; }
.analysis-link:not(:disabled):hover { border-color: var(--blue-hover); }
.analysis-link:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.analysis-link.broken { border-style: dashed; border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover); text-decoration: line-through; cursor: not-allowed; }
</style>
