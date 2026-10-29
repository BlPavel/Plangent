import type { Task, WorkGroup, WorkState } from '@core/models'

export const workGroups: { id: WorkGroup; title: string }[] = [
  { id: 'attention', title: 'Нужно ваше действие' },
  { id: 'working', title: 'В работе' },
  { id: 'preparation', title: 'Подготовка' },
  { id: 'done', title: 'Готово' },
]

export const workStages: { id: WorkState['stage']; label: string }[] = [
  { id: 'plan', label: 'План' },
  { id: 'execution', label: 'Выполнение' },
  { id: 'check', label: 'Проверка' },
  { id: 'finish', label: 'Завершение' },
]

/** Stages of a work as tabs of its page: an errand skips Анализ and План. */
export function workStagesOf(task: Pick<Task, 'kind'>): { tab: string; label: string }[] {
  const tail = [{ tab: 'check', label: 'Проверка' }, { tab: 'finish', label: 'Завершение' }]
  return task.kind === 'errand'
    ? [{ tab: 'chat', label: 'Выполнение' }, ...tail]
    : [{ tab: 'analysis', label: 'Анализ' }, { tab: 'plan', label: 'План' }, { tab: 'exec', label: 'Выполнение' }, ...tail]
}
/** Index of the stage the work is at (everything before it is done); past the end — the work is closed. */
export function workStageIndex(task: Pick<Task, 'kind'>, state: WorkState | null, hasPlan = !!state?.counts.steps): number {
  const stage = state?.stage ?? 'plan', offset = task.kind === 'errand' ? 0 : 2
  if (stage === 'done') return workStagesOf(task).length
  if (stage === 'execution') return offset
  if (stage === 'check') return offset + 1
  if (stage === 'finish') return offset + 2
  return hasPlan ? 1 : 0
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
export function workTab(state: WorkState, kind: 'task' | 'errand'): 'chat' | 'plan' | 'exec' | 'check' | 'finish' {
  switch (state.action) {
    case 'check': return 'check'
    case 'finish': return 'finish'
    case 'plan': return 'plan'
    case 'queue': return 'exec'
    default: return kind === 'errand' ? 'chat' : state.stage === 'check' ? 'check' : 'exec'
  }
}
