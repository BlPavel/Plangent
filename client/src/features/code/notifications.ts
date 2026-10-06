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
  const app = useAppStore()
  const chats = useChatStore()
  const completed = new Map<string, number>()
  return onServerEvent<{ type: string; projectId?: string; event?: { type: string; session_id: string; seq: number; payload: { stopReason?: string } } }>(event => {
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
}
