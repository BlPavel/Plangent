<template>
  <ol class="work-stages" aria-label="Этапы работы">
    <li v-for="(s, i) in stages" :key="s.tab" :class="mark(i)" :aria-current="mark(i) === 'current' ? 'step' : undefined">
      <button type="button" @click="$emit('select', s.tab)"><span class="dot">{{ mark(i) === 'done' ? '✓' : '●' }}</span>{{ s.label }}</button>
      <span v-if="i < stages.length - 1" class="line" aria-hidden="true" />
    </li>
  </ol>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Task, WorkState } from '@core/models'

const props = defineProps<{ task: Task; state: WorkState | null; hasPlan: boolean }>()
defineEmits<{ select: [string] }>()
const stages = computed(() => props.task.kind === 'errand'
  ? [{ tab: 'chat', label: 'Выполнение' }, { tab: 'check', label: 'Проверка' }, { tab: 'finish', label: 'Завершение' }]
  : [{ tab: 'analysis', label: 'Анализ' }, { tab: 'plan', label: 'План' }, { tab: 'exec', label: 'Выполнение' }, { tab: 'check', label: 'Проверка' }, { tab: 'finish', label: 'Завершение' }])
/** Index of the stage the work is at; everything before it is done. */
const current = computed(() => {
  const errand = props.task.kind === 'errand', stage = props.state?.stage ?? 'plan'
  if (stage === 'done') return stages.value.length
  const offset = errand ? 0 : 2
  if (stage === 'execution') return offset
  if (stage === 'check') return offset + 1
  if (stage === 'finish') return offset + 2
  return props.hasPlan ? 1 : 0
})
const mark = (i: number) => i < current.value ? 'done' : i === current.value ? 'current' : 'next'
</script>
<style scoped>
.work-stages { display: flex; align-items: center; gap: 0; margin: 0; padding: 8px var(--sp-5); list-style: none; font-size: 12.5px; border-bottom: 1px solid var(--border); overflow-x: auto; flex-shrink: 0; }
.work-stages li { display: flex; align-items: center; white-space: nowrap; }
.work-stages button { display: inline-flex; gap: 6px; align-items: center; padding: 2px 6px; background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; }
.work-stages .done button { color: var(--accent-hover); }
.work-stages .current button { color: var(--text); font-weight: 600; }
.work-stages .current .dot { color: var(--blue-hover); }
.work-stages .next .dot { opacity: 0.35; }
.line { width: 28px; height: 1px; margin: 0 6px; background: var(--border-strong); }
.done + li .line, .done .line { background: var(--accent-hover); }
</style>
