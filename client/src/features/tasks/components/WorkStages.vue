<template>
  <nav class="stage-nav" aria-label="Этапы работы">
    <AppTabs bare large :model-value="active" :items="tabs.map(s => ({ value: s.id, label: s.label, count: s.count, title: blocked(s.id) || s.countTitle, disabled: !!blocked(s.id) }))" rich label="Этапы работы" @update:model-value="$emit('select', $event)">
      <template #item="{ item }">
        <StageMark :state="mark(item.value).state" :live="live(item.value)" :attention="['architecture', 'qa', 'plan'].includes(item.value) && !!item.count" :label="mark(item.value).label" />{{ item.label }}
        <AppCount v-if="item.count" :value="item.count" tone="warning" :title="item.title" />
      </template>
    </AppTabs>
    <!-- The last stage (Проверка) carries the work's own actions: review and finishing. -->
    <div v-if="!next && $slots.actions" class="stage-actions"><slot name="actions" /></div>
    <!-- One button leads on, as in an errand; on a preparation stage it also marks the stage. -->
    <div v-if="next" class="stage-actions">
      <!-- Until the next stage opens, a quiet line says what it waits for instead of a dead button. -->
      <span v-if="!summary && blocked(next.id)" class="stage-wait" :title="blocked(next.id)"><StageMark v-if="state?.agentWorking" state="draft" live label="Агент работает" />{{ waiting }}</span>
      <AppButton v-else size="sm" variant="blue" :disabled="!!nextBlocked" :title="nextBlocked || nextTitle" @click="goNext">{{ nextLabel }}</AppButton>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { AppCount, AppTabs } from '@shared/ui'
import StageMark from '@shared/ui/StageMark.vue'
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
  /** Stages whose documents the developer is writing by hand: in work before the first save. */
  drafting?: string[]
}>()
const emit = defineEmits<{ select: [string]; complete: [string]; skip: [string] }>()
const order = computed(() => workStagesOf(props.task))
const current = computed(() => workStageIndex(props.task, props.state, props.hasPlan, props.stages))
const selected = computed(() => props.tabs.findIndex(s => s.id === props.active))
const next = computed(() => selected.value >= 0 ? props.tabs[selected.value + 1] : undefined)
// A saved plan is at least a draft, even while its summary is stale or failed to refresh; so is a document being written.
const summaries = computed<StageSummary[]>(() => props.stages.map(s =>
  s.status === 'not_started' && ((s.stage === 'plan' && props.hasPlan) || !!props.drafting?.includes(s.stage)) ? { ...s, status: 'draft' } : s))
const summary = computed(() => summaries.value.find(s => s.stage === props.active))

/** Проверка opens once the agent has done the work; the reason is the button's hint. */
function blocked(id: string): string {
  if (id === 'exec' && !props.hasPlan && props.active !== 'exec') return 'Выполнение откроется, когда появится план'
  if (id !== 'check' || props.active === 'check' || !props.state || props.state.canCheck) return ''
  if (props.task.kind !== 'errand') return props.state.agentWorking ? 'Проверка откроется, когда очередь остановится' : 'Проверка откроется, когда появится план'
  return props.state.agentWorking ? 'Агент ещё работает: Проверка откроется, когда он закончит' : 'Сначала напишите агенту, что сделать'
}

const waiting = computed(() => props.state?.agentWorking ? 'Агент работает…'
  : props.task.kind === 'errand' ? 'Напишите агенту, что сделать' : 'Запустите очередь')
const live = (id: string) => !!props.tabs.find(s => s.id === id)?.live || (id === 'chat' && props.state?.stage === 'execution' && props.state.agentWorking)

type Tone = 'done' | 'current' | 'next'
function mark(id: string): { state: 'ready' | 'changed' | 'skipped' | 'draft' | 'empty'; tone: Tone; label?: string } {
  const i = order.value.findIndex(s => s.tab === id)
  const tone: Tone = i < current.value ? 'done' : i === current.value ? 'current' : 'next'
  const stage = summaries.value.find(s => s.stage === id)
  if (stage) {
    if (stage.status === 'ready') return { state: stage.changed_since_mark ? 'changed' : 'ready', tone: 'done' }
    // An optional stage left behind untouched (the work went on to a later one) is skipped.
    if (stage.status === 'skipped' || (stage.status === 'not_started' && tone === 'done')) return { state: 'skipped', tone: 'next' }
    return { state: stage.status === 'draft' || tone === 'current' ? 'draft' : 'empty', tone, label: tone === 'current' ? 'Текущий этап работы' : undefined }
  }
  // A failed or pending summary request is never evidence of developer approval.
  if (['analysis', 'architecture', 'qa', 'plan'].includes(id)) return { state: id === 'plan' && props.hasPlan ? 'draft' : 'empty', tone }
  if (id === 'chat' && props.state?.canCheck) return { state: 'ready', tone: 'done', label: 'Агент выполнил то, что вы написали' }
  if (id === 'exec' && props.execDone) return { state: 'ready', tone: 'done', label: 'Все пункты плана выполнены' }
  if (tone === 'done') return { state: 'ready', tone }
  return tone === 'current' ? { state: 'draft', tone, label: 'Текущий этап работы' } : { state: 'empty', tone }
}

// An unfinished preparation stage is finished by the developer's mark: a written document becomes ready
// (the basis for the next stages), an empty optional one is skipped. The plan cannot be skipped.
// Marking stays on the stage; a finished one only offers to go on, and the developer goes on themselves.
const isFinished = computed(() => !!summary.value && ((summary.value.status === 'ready' && !summary.value.changed_since_mark) || summary.value.status === 'skipped'))
const marking = computed(() => !!summary.value && !isFinished.value)
const empty = computed(() => summary.value?.status === 'not_started')
// Written by hand but not saved yet: nothing to mark on the server.
const unsaved = computed(() => !!summary.value && !!props.drafting?.includes(summary.value.stage)
  && props.stages.find(s => s.stage === summary.value!.stage)?.status === 'not_started' && !(summary.value.stage === 'plan' && props.hasPlan))
const nextLabel = computed(() => !marking.value ? `${next.value?.label} →`
  : summary.value!.stage === 'plan' ? 'Утвердить план' : empty.value ? 'Пропустить этап' : 'Завершить этап')
const nextBlocked = computed(() => {
  if (!marking.value) return next.value?.id === 'exec' && !props.hasPlan ? blocked('exec') : summary.value ? '' : blocked(next.value?.id ?? '')
  if (unsaved.value) return 'Сначала сохраните документ'
  if (summary.value!.stage === 'plan' && !props.hasPlan) return 'Сначала составьте план'
  return props.locked ? 'Пока выполняется очередь или работа закрыта, этапы не отмечаются' : ''
})
const nextTitle = computed(() => !marking.value ? '' : empty.value
  ? 'Этап необязательный: он отметится пропущенным'
  : summary.value!.stage === 'plan' ? 'План будет утверждён, планировщики остановятся' : 'Этап отметится готовым и станет основанием для следующих')
function goNext() {
  if (!marking.value) emit('select', next.value!.id)
  else if (empty.value) emit('skip', props.active)
  else emit('complete', props.active)
}
</script>
<style scoped>
/* The same bar as the tabs of «Код»: tabs take the row, the next step sits at its end, the bar draws the line. */
.stage-nav { display: flex; align-items: stretch; gap: var(--sp-3); padding: 0 var(--sp-5); border-bottom: 1px solid var(--border); flex-shrink: 0; min-width: 0; }
.stage-nav > :first-child { flex: 1; min-width: 0; overflow-x: auto; }
.stage-wait { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--text-muted); white-space: nowrap; }
.stage-actions {display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; align-self: center; margin-block: var(--sp-1); }
</style>
