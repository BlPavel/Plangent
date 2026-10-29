import type { WorkGroup, WorkState } from '@core/models'

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
