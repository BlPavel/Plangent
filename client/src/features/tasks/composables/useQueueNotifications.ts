import type { Router } from 'vue-router'
import { announceChanges } from '@features/code'
import { api } from '@core/api'
import { onServerEvent, type WorkEvent } from '@core/api/events'
import { platform } from '@core/platform'
import { useAppStore } from '@core/stores/app'
import type { OrchestratorEvent, Task } from '@core/models'
import { remarksLabel } from '../utils/queue-status'

/** Route that opens a task (in its project) and, optionally, one of its agent chats. */
export function taskTarget(taskId: string, projectId?: string | null, chatId?: string | null) {
  const query = new URLSearchParams()
  if (projectId) query.set('project', projectId)
  if (chatId) query.set('session', chatId)
  const qs = query.toString()
  return `/task/${taskId}${qs ? `?${qs}` : ''}`
}

/**
 * Queue events of every task become notifications: a toast while the app is in front, a system
 * notification (opening the task on click) while it is not. "The agent needs you" is raised by
 * the agent-chat store when the chat turns `waiting`, so here it is only a toast.
 */
export function startQueueNotifications(router: Router) {
  const app = useAppStore()
  const focused = () => document.hasFocus()
  // A finished stage that left changes in the repository offers the way to review them (only while the app is in front).
  const announce = (event: { taskId: string; taskKey?: string; projectId?: string }) => {
    if (focused() && event.projectId && event.taskKey) void announceChanges(router, event.projectId, { id: event.taskId, key: event.taskKey })
  }
  // «Готово к проверке» (a finished errand turn) and «исправления готовы» (the agent answered the remarks): open the Проверка tab.
  // The queue of a plan task announces itself above, so only errands and fixes are raised here.
  onServerEvent<WorkEvent>(event => {
    if (!['work:ready_for_check', 'work:fixes_ready'].includes(event.type) || !event.taskId || !event.projectId) return
    const { taskId, projectId } = event
    void api.get<Task>(`/projects/${projectId}/tasks/${taskId}`).then(task => {
      const fixes = event.type === 'work:fixes_ready'
      if (!fixes && task.kind !== 'errand') return
      const name = task.kind === 'errand' ? '⚡ ' + (task.title || 'Поручение') : task.key
      const body = fixes ? 'исправления готовы' : 'готово к проверке'
      if (focused()) app.toast(`${name}: ${body}`, 'success')
      platform.notify?.(name, body, taskTarget(taskId, projectId) + '&tab=check')
    }).catch(() => { /* the task is gone: nothing to announce */ })
  })
  onServerEvent<OrchestratorEvent>(event => {
    if (!event.taskKey) return
    const key = event.taskKey
    const target = taskTarget(event.taskId, event.projectId)
    const alert = (title: string, body: string, tone: 'success' | 'warning' | 'error') => {
      if (focused()) app.toast(`${key}: ${body}`, tone)
      platform.notify?.(`${key}: ${title}`, body, target)
    }
    switch (event.type) {
      case 'session_waiting':
      case 'session_ready_for_execution':
        if (focused()) app.toast(`${key}: ${event.message}`, 'warning')
        break
      case 'queue_paused':
        alert('очередь на паузе', 'Этап выполнен — проверьте результат и продолжите очередь', 'warning')
        void announce(event)
        break
      case 'queue_finished':
        alert('очередь выполнена', (event.failed ? `Готово, но пропущено шагов: ${event.failed}` : 'Все шаги выполнены — можно проверять изменения') + (event.remarks !== undefined ? ` · Ревью: ${remarksLabel(event.remarks)}, они в «Коде»` : ''), event.failed ? 'warning' : 'success')
        void announce(event)
        break
      case 'session_failed':
        alert('шаг не выполнен', event.reason, 'error')
        break
      case 'run_failed':
        alert('очередь остановлена из-за ошибки', event.reason, 'error')
        break
    }
  })
}
