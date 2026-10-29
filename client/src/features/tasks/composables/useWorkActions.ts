import { useAppStore } from '@core/stores/app'
import type { Task, Workspace } from '@core/models'
import { workApi, workspacesApi, type ViewingWarnings } from '../api'

interface Blockers { files?: string[]; commits?: string[] }
const blockersOf = (cause: unknown) => (cause as { blockers?: Blockers }).blockers
const text = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')

/** Actions on a work item shared by the list rows and the work page: an unsaved workspace is never dropped silently. */
export function useWorkActions() {
  const app = useAppStore()

  /** Run an action that may refuse because of unsaved work; ask once and repeat it with the discard flag. */
  async function guarded<T>(action: (discard: boolean) => Promise<T>, what: string): Promise<T | undefined> {
    try { return await action(false) }
    catch (cause) {
      const blockers = blockersOf(cause)
      if (!blockers?.files?.length && !blockers?.commits?.length) { app.toast(text(cause), 'error'); return }
      const list = [...(blockers.files ?? []).map(f => 'не сохранено: ' + f), ...(blockers.commits ?? []).map(c => 'не отправлено: ' + c)]
      const message = what + ' Найдено:\n' + list.slice(0, 15).join('\n') + (list.length > 15 ? '\n… ещё ' + (list.length - 15) : '')
      if (!await app.confirm(message, { confirmLabel: 'Выбросить', danger: true })) return
      try { return await action(true) } catch (again) { app.toast(text(again), 'error') }
    }
  }
  async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    try { return await action() } catch (cause) { app.toast(text(cause), 'error') }
  }
  const close = (t: Task) => guarded(discard => workApi.close(t.project_id, t.id, discard), 'В рабочем месте остались несохранённые изменения.')
  const reopen = (t: Task) => attempt(() => workApi.reopen(t.project_id, t.id))
  const addPlan = (t: Task) => attempt(() => workApi.addPlan(t.project_id, t.id))
  /** «Выбросить» removes the branch and the workspace; «Оставить» only closes the errand. */
  async function cancel(t: Task, mode: 'keep' | 'discard') {
    if (mode === 'discard' && !await app.confirm(`Отменить поручение «${t.title || t.key}» и выбросить изменения? Ветка и рабочее место будут удалены.`, { confirmLabel: 'Выбросить', danger: true })) return
    return attempt(() => workApi.cancel(t.project_id, t.id, mode))
  }
  async function remove(t: Task) {
    if (!await app.confirm(`Удалить «${t.kind === 'errand' ? t.title || 'поручение' : t.key}»? Действие необратимо.`, { confirmLabel: 'Удалить', danger: true })) return false
    return (await guarded(discard => workApi.remove(t.project_id, t.id, discard).then(() => true), 'Рабочее место будет удалено вместе с изменениями.')) === true
  }
  async function errandFrom(t: Task, request: string, agentId?: string | null) {
    if (!request.trim()) return
    return attempt(() => workApi.errandFrom(t.project_id, t.id, { text: request, agent_id: agentId ?? undefined }))
  }
  /** «Смотреть эту ветку» (null — back to the main place): warns about a working agent and about apps running in terminals of another place. */
  async function view(projectId: string, w: Workspace | null) {
    try { return await workspacesApi.view(projectId, w?.id ?? null) }
    catch (cause) {
      const warnings = (cause as { warnings?: ViewingWarnings }).warnings
      if (!warnings) { app.toast(text(cause), 'error'); return }
      const lines = [
        ...(warnings.agentWorking ? ['Агент этой работы ещё вносит правки: файлы будут меняться под вами.'] : []),
        ...warnings.terminals.map(t => 'В терминале «' + t.title + '» запущено: ' + t.processes.map(p => p.name).join(', ') + ' (другая ветка). Остановить его нужно самому.'),
      ]
      if (!await app.confirm(lines.join('\n'), { confirmLabel: w ? 'Смотреть всё равно' : 'Вернуться всё равно' })) return
      return attempt(() => workspacesApi.view(projectId, w?.id ?? null, true))
    }
  }
  return { close, reopen, addPlan, cancel, remove, errandFrom, view, attempt, guarded }
}
