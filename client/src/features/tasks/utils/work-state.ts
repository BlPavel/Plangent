import type { PreparationStage, StageSummary, Task, WorkGroup, WorkState } from '@contracts'

export const workGroups: { id: WorkGroup; title: string }[] = [
  { id: 'attention', title: 'Нужно ваше действие' },
  { id: 'working', title: 'В работе' },
  { id: 'preparation', title: 'Подготовка' },
  { id: 'done', title: 'Готово' },
]

/** Stages of a work as tabs of its page: an errand skips the preparation (Анализ, Архитектура, QA, План). */
export function workStagesOf(task: Pick<Task, 'kind'>): { tab: string; label: string }[] {
  const tail = [{ tab: 'check', label: 'Проверка' }]
  return task.kind === 'errand'
    ? [{ tab: 'chat', label: 'Выполнение' }, ...tail]
    : [{ tab: 'analysis', label: 'Анализ' }, { tab: 'architecture', label: 'Архитектура' }, { tab: 'qa', label: 'QA' }, { tab: 'plan', label: 'План' }, { tab: 'exec', label: 'Выполнение' }, ...tail]
}
/**
 * Position of the current work stage. During preparation it is the latest stage the developer worked on:
 * a marked one (ready or skipped) leads to the next. Анализ, Архитектура and QA are optional, so the stages
 * before it count as passed. Without the preparation summary (the work list) a plan means the План stage.
 */
export function workStageIndex(task: Pick<Task, 'kind'>, state: WorkState | null, hasPlan = !!state?.counts.steps, stages: StageSummary[] = []): number {
  const stage = state?.stage ?? 'plan', offset = task.kind === 'errand' ? 0 : 4
  if (stage === 'done') return workStagesOf(task).length
  if (stage === 'execution') return offset
  if (stage === 'check') return offset + 1
  if (!stages.length) return hasPlan ? 3 : 0
  const order: PreparationStage[] = ['analysis', 'architecture', 'qa', 'plan']
  const latest = order.findLastIndex(id => (id === 'plan' && hasPlan) || (stages.find(s => s.stage === id)?.status ?? 'not_started') !== 'not_started')
  if (latest < 0) return 0
  const marked = ['ready', 'skipped'].includes(stages.find(s => s.stage === order[latest])?.status ?? 'not_started')
  // An earlier approval cannot advance an erased plan into execution.
  if (order[latest] === 'plan' && !hasPlan) return latest
  return marked ? latest + 1 : latest
}

/** Tone of the status icon in a list row; the text itself comes from the server. */
export function workTone(state: WorkState): 'danger' | 'warn' | 'progress' | 'done' | 'neutral' {
  if (state.status === 'failed') return 'danger'
  if (state.group === 'attention') return 'warn'
  if (state.group === 'working') return 'progress'
  if (state.group === 'done') return 'done'
  return 'neutral'
}

/** Where the main button of a row leads inside the work page. */
export function workTab(state: WorkState, kind: 'task' | 'errand'): 'chat' | 'plan' | 'exec' | 'check' {
  switch (state.action) {
    case 'check': return 'check'
    case 'plan': return 'plan'
    case 'queue': return 'exec'
    default: return kind === 'errand' ? 'chat' : state.stage === 'check' ? 'check' : 'exec'
  }
}
