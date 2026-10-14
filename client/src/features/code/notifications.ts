import type { Router } from 'vue-router'
import { onServerEvent } from '@core/api/events'
import { platform } from '@core/platform'
import { useAppStore } from '@core/stores/app'
import { useChatStore } from '@features/agent-chat'
import { codeApi } from './api'
import { codeTarget } from './navigation'

/** Tells the developer that a stage left changes to review. No automatic navigation: the toast only offers the link. */
export async function announceChanges(router: Router, projectId: string, task: { id: string; key: string }) {
  let count = 0
  try { count = (await codeApi.changes(projectId)).length } catch { return }
  if (!count) return
  useAppStore().toast(`${task.key}: Есть изменения для просмотра`, 'info', { label: 'Посмотреть изменения', run: () => void router.push(codeTarget(projectId, task)) })
}

/** Completed review rounds and requests for a decision use the shared toast/system channels. */
export function startCodeNotifications(router: Router) {
  const stopFinish = startFinishNotifications(router)
  const app = useAppStore()
  const chats = useChatStore()
  const completed = new Map<string, number>()
  const stopReview = onServerEvent<{ type: string; projectId?: string; event?: { type: string; session_id: string; seq: number; payload: { stopReason?: string } } }>(event => {
    const turn = event.event
    if (event.type === 'agent_event' && turn?.type === 'turn_end' && turn.payload.stopReason !== 'cancelled') {
      const session = chats.sessions.find(session => session.id === turn.session_id)
      if (!session || session.role !== 'code-fixer' || turn.seq <= (completed.get(session.id) ?? 0)) return
      completed.set(session.id, turn.seq)
      const target = codeTarget(session.project_id)
      const text = `${session.title}: агент завершил обработку замечаний`
      if (document.hasFocus()) app.toast(text, 'success', { label: 'Открыть код', run: () => void router.push(target) })
      platform.notify?.('Ревью: агент закончил работу', text, target)
      return
    }
    if (event.type !== 'code_review_needs_decision' || !event.projectId) return
    const projectId = event.projectId
    const target = codeTarget(projectId)
    const text = 'Агент не согласен с замечанием — нужно ваше решение'
    if (document.hasFocus()) app.toast(text, 'warning', { label: 'Открыть код', run: () => void router.push(target) })
    platform.notify?.('Код: нужно ваше решение', text, target)
  })
  return () => { stopFinish(); stopReview() }
}

/** Server finish events use the same toast and system notification path as review. */
export function startFinishNotifications(router: Router) {
  const app = useAppStore()
  return onServerEvent<{ type: string; projectId?: string; title?: string; message?: string }>(event => {
    if (event.type !== 'finish:notification' || !event.projectId) return
    const target = codeTarget(event.projectId), text = event.message || event.title || 'Завершение работ'
    app.toast(text, event.title?.startsWith('Ошибка') ? 'error' : 'info', { label: 'Открыть код', run: () => void router.push(target) })
    platform.notify?.(event.title || 'Завершение работ', text, target)
  })
}
