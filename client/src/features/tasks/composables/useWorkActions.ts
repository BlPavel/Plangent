import { useDraftsStore } from '@core/stores/drafts'
import { useAppStore } from '@core/stores/app'
import { ref } from 'vue'
import type { Task } from '@contracts'
import { workApi } from '../api'

/** Works being deleted: the request takes a while, and the list and the page both show it. A deleted one stays marked until it is gone from the list. */
const removing = ref<string[]>([])
export const isRemoving = (id: string) => removing.value.includes(id)

interface Blockers { files?: string[]; commits?: string[] }
const blockersOf = (cause: unknown) => (cause as { blockers?: Blockers }).blockers
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
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
  /** Closing keeps the branch with every commit, pushed or not; only uncommitted files are lost. One question either way. */
  async function close(t: Task) {
    const check = await attempt(() => workApi.closeCheck({ params: { projectId: t.project_id, taskId: t.id } }))
    if (!check) return
    const files = check.files.length, commits = check.commits.length
    const branch = t.branch_name ? ` «${t.branch_name}»` : ''
    const message = (files
      ? `В папке работы есть изменения, которые не закоммичены (${files} ${plural(files, 'файл', 'файла', 'файлов')}). При закрытии они пропадут безвозвратно.\n\n`
        + `Закоммиченное останется в ветке${branch}. Чтобы сохранить изменения, отмените и сделайте коммит во вкладке «Проверка».`
      : `Закрыть «${t.kind === 'errand' ? t.title || 'поручение' : t.key}»? Рабочее место уберётся, весь закоммиченный код останется в ветке${branch}.`)
      + (commits ? `\n\n${commits} ${plural(commits, 'коммит есть', 'коммита есть', 'коммитов есть')} только локально, в origin не отправлены. Они останутся в ветке.` : '')
    if (!await app.confirm(message, files ? { title: 'Закрыть задачу', confirmLabel: 'Закрыть и потерять изменения', danger: true } : { title: 'Закрыть задачу', confirmLabel: 'Закрыть' })) return
    // The folder may have changed since the question: losing what appeared later still asks again.
    return guarded(discard => workApi.close(t.project_id, t.id, files > 0 || discard), 'Пока вы подтверждали, в папке работы появились новые изменения. Они пропадут при закрытии.')
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
    removing.value.push(t.id)
    const done = (await attempt(() => workApi.remove(t.project_id, t.id, true).then(() => { useDraftsStore().clearPrefix(`task:${t.id}:`); return true }))) === true
    if (!done) removing.value = removing.value.filter(id => id !== t.id)
    return done
  }
  async function errandFrom(t: Task, request: string, agentId?: string | null) {
    if (!request.trim()) return
    return attempt(() => workApi.errandFrom(t.project_id, t.id, { text: request, agent_id: agentId ?? undefined }))
  }
  return { close, reopen, addPlan, cancel, remove, errandFrom, attempt, guarded }
}
