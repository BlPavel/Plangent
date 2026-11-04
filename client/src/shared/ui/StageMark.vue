<template>
  <span class="stage-mark" :class="[state, { live }]" role="img" :title="text" :aria-label="text">
    <svg v-if="state === 'ready' || state === 'changed'" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor" /><path d="M3.4 6.2l1.8 1.8 3.4-3.7" stroke="var(--bg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <svg v-else-if="state === 'skipped'" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l5 3.5-5 3.5z" fill="currentColor" /><path d="M9.5 2.5v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
    <svg v-else-if="state === 'draft'" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="currentColor" /></svg>
    <svg v-else viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.3" stroke="currentColor" stroke-width="1.3" /></svg>
    <i v-if="state === 'changed'" class="changed-dot" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
/**
 * A compact status of a stage that can be told apart without colour: filled circle with a tick, skip-forward,
 * small filled circle, empty circle. `changed` is «ready», but the material was edited after the mark.
 */
const props = defineProps<{
    state: 'ready' | 'changed' | 'skipped' | 'draft' | 'empty';
    live?: boolean;
    label?: string;
}>();
const names = { ready: 'Готово', changed: 'Изменён после отметки', skipped: 'Пропущено', draft: 'Черновик', empty: 'Не начато' };
const text = computed(() => props.label ?? names[props.state]);
</script>

<style scoped>
.stage-mark { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex-shrink: 0; color: var(--text-faint); }
.stage-mark svg { width: 100%; height: 100%; }
.ready, .changed { color: var(--accent-hover); }
.skipped { color: var(--text-muted); opacity: 0.75; }
.draft { color: var(--blue-hover); }
.empty { opacity: 0.55; }
.live { animation: stage-pulse var(--motion-pulse) ease-in-out infinite; }
.changed-dot { position: absolute; top: -2px; right: -3px; width: 6px; height: 6px; border-radius: var(--radius-round); background: var(--warning); border: 1px solid var(--bg); }
@keyframes stage-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
