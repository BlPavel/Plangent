import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { gitApi } from '../api'
import type { GitTracking, GitBranch, GitPreferences, Coauthor } from '../git-types'

export const useGitStore = defineStore('code-git', () => {
  const projectId = ref(''), workspaceId = ref<string | undefined>(), repository = ref<GitTracking | null>(null), branches = ref<GitBranch[]>([])
  const settings = ref<GitPreferences | null>(null), coauthors = ref<Coauthor[]>([])
  /** lastAction lets each panel show the result of its own operation (commit — in the commit panel, the rest — in the header). */
  const operationId = ref(''), output = ref(''), error = ref(''), lastAction = ref('')
  const blocked = computed(() => operationId.value ? 'Выполняется git-операция' : repository.value?.busyReason ?? '')
  /** While the developer's merge/rebase goes on, staging still works (it marks a conflict resolved); committing, switching, pull and push wait. */
  const operationBlock = computed(() => {
    const kind = repository.value?.operation?.kind
    return kind ? `Идёт ${kind}: завершите или отмените его в своём git-клиенте` : ''
  })
  const writeBlocked = computed(() => blocked.value || operationBlock.value)
  /** What «Diff ветки» compares with: origin/<base branch from the settings>, else origin/main or origin/master. */
  const baseRef = computed(() => {
    const remote = branches.value.filter(b => b.remote).map(b => b.name)
    const wanted = settings.value?.base_branch ? 'origin/' + settings.value.base_branch.replace(/^origin\//, '') : ''
    return [wanted, 'origin/main', 'origin/master'].find(name => name && remote.includes(name)) ?? (wanted || remote[0] || '')
  })
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  async function refresh() {
    const p = projectId.value, w = workspaceId.value, token = ++generation
    if (!p) return
    try {
      const [info, refs, prefs, authors] = await Promise.all([
        gitApi.repository(p, w), gitApi.branches(p, w), gitApi.settings(p, w), gitApi.coauthors(p, w),
      ])
      if (token !== generation || p !== projectId.value || w !== workspaceId.value) return
      repository.value = info; branches.value = refs; settings.value = prefs; coauthors.value = authors
    } catch (cause) { if (p === projectId.value && token === generation) error.value = String(cause) }
  }
  /** The store follows one (project, workspace) pair, so «Проверка» of a work and «Код» of the project do not overwrite each other. */
  async function start(p: string, workspace?: string) {
    stop()
    projectId.value = p; workspaceId.value = workspace; repository.value = null; branches.value = []; settings.value = null
    coauthors.value = []; error.value = ''; output.value = ''; operationId.value = ''; lastAction.value = ''
    unsubscribe = onServerEvent<{
      type: string; projectId?: string; project_id?: string; operationId?: string; output?: string
    }>(event => {
      if (event.type === 'git:progress' && event.project_id === projectId.value && event.operationId === operationId.value)
        output.value = (output.value + (event.output ?? '')).slice(-1000000)
      if (event.type === 'events:connected' || ['code:changed', 'finish:changed', 'agent_session', 'queue_updated'].includes(event.type)) {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 200)
      }
    })
    await refresh()
  }
  async function refreshBranches() {
    const p = projectId.value
    const w = workspaceId.value
    const refs = await gitApi.refreshBranches(p, w)
    if (p === projectId.value && w === workspaceId.value) branches.value = refs
    return refs
  }
  function stop() { unsubscribe?.(); unsubscribe = undefined; clearTimeout(timer); generation++; projectId.value = ''; workspaceId.value = undefined }
  async function run(action: string, input: object = {}) {
    const reason = ['stage', 'unstage', 'fetch'].includes(action) ? blocked.value : writeBlocked.value
    if (reason) throw new Error(reason)
    const p = projectId.value, current = crypto.randomUUID()
    operationId.value = current; lastAction.value = action; output.value = ''; error.value = ''
    try {
      const result = await gitApi.operation(p, action, { ...input, operationId: current }, workspaceId.value)
      if (p === projectId.value && current === operationId.value) output.value ||= result.output
      return result
    } catch (cause) {
      if (p === projectId.value && current === operationId.value) {
        const failure = cause as Error & { output?: string }
        error.value = failure.message; if (!output.value) output.value = failure.output ?? ''
      }
      throw cause
    } finally {
      if (p === projectId.value && current === operationId.value) { operationId.value = ''; await refresh() }
    }
  }
  async function cancel() {
    if (operationId.value) await gitApi.operation(projectId.value, 'cancel', { operationId: operationId.value }, workspaceId.value)
  }
  /** Hides the result of the finished operation. */
  function dismiss() { if (!operationId.value) { error.value = ''; output.value = ''; lastAction.value = '' } }
  return { projectId, workspaceId, repository, branches, settings, coauthors, operationId, output, error, lastAction, blocked, operationBlock, writeBlocked, baseRef, start, stop, refresh, refreshBranches, run, cancel, dismiss }
})
