<template>
  <nav class="stage-nav" aria-label="Этапы работы">
    <AppTabs :model-value="active" :items="tabs.map(s => ({ value: s.id, label: s.label, count: s.count, title: s.countTitle }))" rich label="Этапы работы" @update:model-value="$emit('select', $event)">
      <template #item="{ item }">
        <StageMark :state="mark(item.value).state" :live="tabs.find(s => s.id === item.value)?.live" :label="mark(item.value).label" />{{ item.label }}
        <AppCount v-if="item.count" :value="item.count" tone="warning" :title="item.title" />
      </template>
    </AppTabs>
    <div v-if="next" class="stage-actions">
      <SplitButton v-if="summary" variant="blue" :items="menu" :disabled="primaryDisabled" :title="primaryTitle" menu-title="Другие действия этапа" :menu-disabled="!menu.length" @click="primary">{{ primaryLabel }}</SplitButton>
      <AppButton v-else size="sm" variant="blue" @click="$emit('select', next.id)">{{ next.label }} →</AppButton>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { AppCount, AppTabs } from '@shared/ui'
import SplitButton from '@shared/ui/SplitButton.vue'
import StageMark from '@shared/ui/StageMark.vue'
import type { MenuItem } from '@shared/ui/AppMenu.vue'
import type { StageSummary, Task, WorkState } from '@contracts'
import { workStageIndex, workStagesOf } from '../utils/work-state'

const props = defineProps<{
  task: Task; state: WorkState | null; hasPlan: boolean; active: string
  tabs: { id: string; label: string; count?: number; countTitle?: string; live?: boolean }[]
  /** Preparation stages as the server sees them; empty for an errand. */
  stages: StageSummary[]
  /** All steps of a non-empty plan are done. */
  execDone: boolean
  /** The stage cannot be marked right now (the queue is running, the work is closed). */
  locked?: boolean
}>()
const emit = defineEmits<{ select: [string]; complete: [string]; skip: [string] }>()
const order = computed(() => workStagesOf(props.task))
const current = computed(() => workStageIndex(props.task, props.state, props.hasPlan))
const selected = computed(() => props.tabs.findIndex(s => s.id === props.active))
const next = computed(() => selected.value >= 0 ? props.tabs[selected.value + 1] : undefined)
const summary = computed(() => props.stages.find(s => s.stage === props.active))

type Tone = 'done' | 'current' | 'next'
function mark(id: string): { state: 'ready' | 'changed' | 'skipped' | 'draft' | 'empty'; tone: Tone; label?: string } {
  const i = order.value.findIndex(s => s.tab === id)
  const tone: Tone = i < current.value ? 'done' : i === current.value ? 'current' : 'next'
  const stage = props.stages.find(s => s.stage === id)
  if (stage) {
    if (stage.status === 'ready') return { state: stage.changed_since_mark ? 'changed' : 'ready', tone: 'done' }
    if (stage.status === 'skipped') return { state: 'skipped', tone: 'next' }
    return { state: stage.status === 'draft' ? 'draft' : 'empty', tone }
  }
  // A failed or pending summary request is never evidence of developer approval.
  if (['analysis', 'architecture', 'qa', 'plan'].includes(id)) return { state: id === 'plan' && props.hasPlan ? 'draft' : 'empty', tone }
  if (id === 'exec' && props.execDone) return { state: 'ready', tone: 'done', label: 'Все пункты плана выполнены' }
  if (tone === 'done') return { state: 'ready', tone }
  return tone === 'current' ? { state: 'draft', tone, label: 'Текущий этап работы' } : { state: 'empty', tone }
}

// One place for the transition: finish the stage and open the next one; «Пропустить этап» sits in the menu.
// A finished stage (or a skipped one) only leads on.
const isFinished = computed(() => !!summary.value && ((summary.value.status === 'ready' && !summary.value.changed_since_mark) || summary.value.status === 'skipped'))
const empty = computed(() => summary.value?.status === 'not_started')
const primaryLabel = computed(() => isFinished.value ? `Перейти к ${next.value?.label}` : `Завершить и перейти к ${next.value?.label}`)
const primaryDisabled = computed(() => !isFinished.value && (empty.value || !!props.locked))
const primaryTitle = computed(() => isFinished.value ? '' : props.locked ? 'Пока выполняется очередь или работа закрыта, этапы не отмечаются'
  : empty.value ? 'Материала ещё нет: сохраните его или пропустите этап' : 'Отметить этап готовым: он станет основанием для следующих. Агент при переходе не запускается')
const menu = computed<MenuItem[]>(() => summary.value && summary.value.stage !== 'plan' && summary.value.status !== 'ready' && summary.value.status !== 'skipped'
  ? [{ label: 'Пропустить этап', hint: summary.value.status === 'draft' ? 'Набросок сохранится, но основанием не будет' : 'Перейти дальше без этого раздела', disabled: !!props.locked, action: () => emit('skip', props.active) }]
  : [])
function primary() {
  if (isFinished.value) emit('select', next.value!.id)
  else emit('complete', props.active)
}
</script>
<style scoped>
.stage-nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; padding: 8px var(--sp-5); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.work-stages { display: flex; align-items: center; margin: 0; padding: 0; list-style: none; font-size: var(--fs-md); overflow-x: auto; }
.work-stages li { display: flex; align-items: center; white-space: nowrap; }
.work-stages button { display: inline-flex; gap: 7px; align-items: center; min-height: 30px; padding: 4px 8px; background: none; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; font: inherit; }
.work-stages button:hover { background: var(--bg3); }
.work-stages button.selected { color: var(--text); background: var(--blue-soft); border-color: var(--blue); }
.stage-actions { display: flex; gap: 8px; margin-left: auto; }
.stage-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--warning); color: var(--bg); font-size: var(--fs-xs); font-weight: 600; }
.work-stages .done button { color: var(--accent-hover); }
.work-stages .current button { color: var(--text); font-weight: 600; }
.line { width: 28px; height: 1px; margin: 0 6px; background: var(--border-strong); }
.done .line { background: var(--accent-hover); }
</style>
