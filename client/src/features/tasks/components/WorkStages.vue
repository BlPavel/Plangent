<template>
  <nav class="stage-nav" aria-label="Этапы работы">
    <ol class="work-stages">
      <li v-for="(s, i) in tabs" :key="s.id" :class="mark(s.id)">
        <button type="button" :class="{ selected: active === s.id }" :aria-current="active === s.id ? 'page' : undefined" @click="$emit('select', s.id)"><span class="dot" :class="{ live: s.live }" :title="mark(s.id) === 'current' ? 'Текущий этап работы' : undefined" aria-hidden="true">{{ mark(s.id) === 'done' ? '✓' : '' }}</span>{{ s.label }}<span v-if="s.count" class="stage-count" :title="s.countTitle">{{ s.count }}</span></button>
        <span v-if="i < tabs.length - 1" class="line" aria-hidden="true" />
      </li>
    </ol>
    <div class="stage-actions">
      <AppButton v-if="previous" size="sm" @click="$emit('select', previous.id)">← {{ previous.label }}</AppButton>
      <AppButton v-if="next" size="sm" variant="blue" @click="$emit('select', next.id)">{{ next.label }} →</AppButton>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import type { Task, WorkState } from '@core/models'
import { workStageIndex, workStagesOf } from '../utils/work-state'

const props = defineProps<{ task: Task; state: WorkState | null; hasPlan: boolean; active: string; tabs: { id: string; label: string; count?: number; countTitle?: string; live?: boolean }[] }>()
defineEmits<{ select: [string] }>()
const stages = computed(() => workStagesOf(props.task))
const current = computed(() => workStageIndex(props.task, props.state, props.hasPlan))
const selected = computed(() => props.tabs.findIndex(s => s.id === props.active))
const previous = computed(() => selected.value > 0 ? props.tabs[selected.value - 1] : undefined)
const next = computed(() => selected.value >= 0 ? props.tabs[selected.value + 1] : undefined)
function mark(id: string) {
  const i = stages.value.findIndex(s => s.tab === id)
  return i < current.value ? 'done' : i === current.value ? 'current' : 'next'
}
</script>
<style scoped>
.stage-nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; padding: 8px var(--sp-5); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.work-stages { display: flex; align-items: center; margin: 0; padding: 0; list-style: none; font-size: 12.5px; overflow-x: auto; }
.work-stages li { display: flex; align-items: center; white-space: nowrap; }
.work-stages button { display: inline-flex; gap: 7px; align-items: center; min-height: 30px; padding: 4px 8px; background: none; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; font: inherit; }
.work-stages button:hover { background: var(--bg3); }
.work-stages button.selected { color: var(--text); background: var(--blue-soft); border-color: var(--blue); }
.dot { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; flex-shrink: 0; line-height: 1; }
.dot:empty::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--border-strong); }
.current .dot:empty::before, .dot.live:empty::before { background: var(--blue-hover); }
.stage-actions { display: flex; gap: 8px; margin-left: auto; }
.stage-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--warning); color: var(--bg); font-size: 11px; font-weight: 600; }
.work-stages .done button { color: var(--accent-hover); }
.work-stages .current button { color: var(--text); font-weight: 600; }
.work-stages .current .dot { color: var(--blue-hover); }
.work-stages .next .dot { opacity: 0.35; }
.line { width: 28px; height: 1px; margin: 0 6px; background: var(--border-strong); }
.done .line { background: var(--accent-hover); }
</style>
