import { useDraftsStore } from '@core/stores/drafts'
import { useAppStore } from '@core/stores/app'
import type { Task } from '@contracts'
import { workApi } from '../api'

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
  /** Closing keeps the branch: only what is not committed is lost; unpushed commits stay in the branch. */
  async function close(t: Task) {
    try { return await workApi.close(t.project_id, t.id, false) }
    catch (cause) {
      const blockers = blockersOf(cause)
      const files = blockers?.files?.length ?? 0, commits = blockers?.commits?.length ?? 0
      if (!files && !commits) { app.toast(text(cause), 'error'); return }
      const branch = t.branch_name ? ` «${t.branch_name}»` : ''
      const message = files
        ? `В папке работы есть изменения, которые не закоммичены (${files} ${files % 10 === 1 && files % 100 !== 11 ? 'файл' : files % 10 >= 2 && files % 10 <= 4 && (files % 100 < 12 || files % 100 > 14) ? 'файла' : 'файлов'}). При закрытии они пропадут безвозвратно.\n\nКоммиты останутся в ветке${branch}. Чтобы сохранить изменения, отмените и сделайте коммит во вкладке «Завершение».`
        : `Коммиты есть только локально, в origin они не отправлены. Они не пропадут: останутся в ветке${branch}.`
      if (!await app.confirm(message, files ? { confirmLabel: 'Закрыть и потерять изменения', danger: true } : { confirmLabel: 'Закрыть работу' })) return
      try { return await workApi.close(t.project_id, t.id, true) } catch (again) { app.toast(text(again), 'error') }
    }
  }
  const reopen = (t: Task) => attempt(() => workApi.reopen(t.project_id, t.id))
  const addPlan = (t: Task) => attempt(() => workApi.addPlan(t.project_id, t.id))
  /** «Выбросить» removes the branch and the workspace; «Оставить» only closes the errand. */
  async function cancel(t: Task, mode: 'keep' | 'discard') {
    if (mode === 'discard' && !await app.confirm(`Отменить поручение «${t.title || t.key}» и выбросить изменения? Ветка и рабочее место будут удалены.`, { confirmLabel: 'Выбросить', danger: true })) return
    return attempt(() => workApi.cancel(t.project_id, t.id, mode))
  }
  async function remove(t: Task) {
    // One question: deleting already means throwing away the workspace with whatever is unsaved or unpushed in it.
    if (!await app.confirm(`Удалить «${t.kind === 'errand' ? t.title || 'поручение' : t.key}»? Рабочее место удалится вместе со всеми изменениями, в том числе несохранёнными и неотправленными. Действие необратимо.`, { confirmLabel: 'Удалить', danger: true })) return false
    return (await attempt(() => workApi.remove(t.project_id, t.id, true).then(() => { useDraftsStore().clearPrefix(`task:${t.id}:`); return true }))) === true
  }
  async function errandFrom(t: Task, request: string, agentId?: string | null) {
    if (!request.trim()) return
    return attempt(() => workApi.errandFrom(t.project_id, t.id, { text: request, agent_id: agentId ?? undefined }))
  }
  return { close, reopen, addPlan, cancel, remove, errandFrom, attempt, guarded }
}
