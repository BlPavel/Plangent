import type { Router } from 'vue-router'
import { onServerEvent } from '@core/api/events'
import { platform } from '@core/platform'
import { useAppStore } from '@core/stores/app'
import { codeApi } from './api'
import { codeTarget } from './navigation'

/** Tells the developer that a stage left changes to review. No automatic navigation: the toast only offers the link. */
export async function announceChanges(router: Router, projectId: string, task: { id: string; key: string }) {
  let count = 0
  try { count = (await codeApi.changes(projectId)).length } catch { return }
  if (!count) return
  useAppStore().toast(`${task.key}: Есть изменения для просмотра`, 'info', { label: 'Посмотреть изменения', run: () => void router.push(codeTarget(projectId, task)) })
}

/**
 * An agent that disputes a remark asks for the developer's decision: same channel as a blocked queue —
 * a toast while the app is in front, a system notification (opening the «Код» tab) while it is not.
 */
export function startCodeNotifications(router: Router) {
  const app = useAppStore()
  onServerEvent<{ type: string; projectId?: string }>(event => {
    if (event.type !== 'code_review_needs_decision' || !event.projectId) return
    const projectId = event.projectId
    const target = codeTarget(projectId)
    const text = 'Агент не согласен с замечанием — нужно ваше решение'
    if (document.hasFocus()) app.toast(text, 'warning', { label: 'Открыть код', run: () => void router.push(target) })
    platform.notify?.('Код: нужно ваше решение', text, target)
  })
}
