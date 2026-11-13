<template>
  <nav class="stage-nav" aria-label="Этапы работы">
    <AppTabs bare large :model-value="active" :items="tabs.map(s => ({ value: s.id, label: s.label, count: s.count, title: blocked(s.id) || s.countTitle, disabled: !!blocked(s.id) }))" rich label="Этапы работы" @update:model-value="$emit('select', $event)">
      <template #item="{ item }">
        <StageMark :state="mark(item.value).state" :live="live(item.value)" :label="mark(item.value).label" />{{ item.label }}
        <AppCount v-if="item.count" :value="item.count" tone="warning" :title="item.title" />
      </template>
    </AppTabs>
    <!-- The last stage (Проверка) carries the work's own actions: review and finishing. -->
    <div v-if="!next && $slots.actions" class="stage-actions"><slot name="actions" /></div>
    <div v-if="next" class="stage-actions">
      <SplitButton v-if="summary" variant="blue" :items="menu" :disabled="primaryDisabled" :title="primaryTitle" menu-title="Другие действия этапа" :menu-disabled="!menu.length" @click="primary">{{ primaryLabel }}</SplitButton>
      <!-- Until the next stage opens, a quiet line says what it waits for instead of a dead button. -->
      <span v-else-if="blocked(next.id)" class="stage-wait" :title="blocked(next.id)"><StageMark v-if="state?.agentWorking" state="draft" live label="Агент работает" />{{ waiting }}</span>
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
const prev = computed(() => selected.value > 0 ? props.tabs[selected.value - 1] : undefined)
const next = computed(() => selected.value >= 0 ? props.tabs[selected.value + 1] : undefined)
const summary = computed(() => props.stages.find(s => s.stage === props.active))

/** Проверка opens once the agent has done the work; the reason is the button's hint. */
function blocked(id: string): string {
  if (id !== 'check' || props.active === 'check' || !props.state || props.state.canCheck) return ''
  if (props.task.kind !== 'errand') return 'Проверка откроется, когда очередь выполнения дойдёт до конца'
  return props.state.agentWorking ? 'Агент ещё работает: Проверка откроется, когда он закончит' : 'Сначала напишите агенту, что сделать'
}

const waiting = computed(() => props.state?.agentWorking ? 'Агент работает…'
  : props.task.kind === 'errand' ? 'Напишите агенту, что сделать' : 'Ждёт конца очереди')
const live = (id: string) => !!props.tabs.find(s => s.id === id)?.live || (id === 'chat' && !!props.state?.agentWorking)

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
  if (id === 'chat' && props.state?.canCheck && !props.state.agentWorking) return { state: 'ready', tone: 'done', label: 'Агент выполнил то, что вы написали' }
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
/* The same bar as the tabs of «Код»: tabs take the row, the next step sits at its end, the bar draws the line. */
.stage-nav { display: flex; align-items: stretch; gap: var(--sp-3); padding: 0 var(--sp-5); border-bottom: 1px solid var(--border); flex-shrink: 0; min-width: 0; }
.stage-nav > :first-child { flex: 1; min-width: 0; overflow-x: auto; }
.stage-wait { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--text-muted); white-space: nowrap; }
.stage-actions {display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; align-self: center; margin-block: var(--sp-1); }
</style>
