import type { CodeReviewItem, CodeReviewMessage } from '../types'

/**
 * Where a thread stands, from the developer's side:
 * draft — not sent yet; queued — their reply waits for the batch; agent — with the agent;
 * waiting — the agent replied and waits for them; closed — accepted, answered or rejected.
 */
export type ThreadState = 'draft' | 'queued' | 'agent' | 'waiting' | 'closed'

export function threadState(item: CodeReviewItem, messages: CodeReviewMessage[]): ThreadState {
  if (item.status === 'draft') return 'draft'
  if (messages.some(m => m.item_id === item.id && m.author === 'developer' && !m.sent)) return 'queued'
  if (item.closed) return 'closed'
  return item.status === 'sent' ? 'agent' : 'waiting'
}

export function stateLabel(item: CodeReviewItem, state: ThreadState, working = false): string {
  if (state === 'draft') return 'Черновик'
  if (state === 'queued') return 'Ответ в очереди'
  if (state === 'agent') return working ? 'Агент работает над этим пунктом…' : 'У агента'
  if (state === 'closed') return item.status === 'rejected' ? 'Отклонено' : item.status === 'done' ? 'Принято' : 'Отвечено'
  return item.status === 'done' ? 'Проверьте правку' : item.status === 'needs_decision' ? 'Агент не согласен' : 'Агент ответил'
}

/** Waiting threads first, then work in progress, then drafts; closed last. */
export const STATE_ORDER: Record<ThreadState, number> = { waiting: 0, queued: 1, agent: 2, draft: 3, closed: 4 }

/** Older structured suggestions are displayed as ordinary discussion text. */
export function discussionText(message: CodeReviewMessage): string {
  if (!message.options.length) return message.text
  const options = message.options.map((option, index) =>
    `${index + 1}. ${option.label}${option.recommended ? ' (рекомендую)' : ''}`,
  ).join('\n')
  return `${message.text}\n\n${options}`
}
