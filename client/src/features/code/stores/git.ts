import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { gitApi } from '../api'
import type { GitTracking, GitBranch, GitPreferences, Coauthor } from '../git-types'

export const useGitStore = defineStore('code-git', () => {
  const projectId = ref(''), repository = ref<GitTracking | null>(null), branches = ref<GitBranch[]>([])
  const settings = ref<GitPreferences | null>(null), coauthors = ref<Coauthor[]>([])
  /** lastAction lets each panel show the result of its own operation (commit — in the commit panel, the rest — in the header). */
  const operationId = ref(''), output = ref(''), error = ref(''), lastAction = ref('')
  const blocked = computed(() => operationId.value ? 'Выполняется git-операция' : repository.value?.busyReason ?? '')
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  async function refresh() {
    const p = projectId.value, token = ++generation
    if (!p) return
    try {
      const [info, refs, prefs, authors] = await Promise.all([
        gitApi.repository(p), gitApi.branches(p), gitApi.settings(p), gitApi.coauthors(p),
      ])
      if (token !== generation || p !== projectId.value) return
      repository.value = info; branches.value = refs; settings.value = prefs; coauthors.value = authors
    } catch (cause) { if (p === projectId.value && token === generation) error.value = String(cause) }
  }
  async function start(p: string) {
    stop()
    projectId.value = p; repository.value = null; branches.value = []; settings.value = null
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
  function stop() { unsubscribe?.(); unsubscribe = undefined; clearTimeout(timer); generation++; projectId.value = '' }
  async function run(action: string, input: object = {}) {
    if (blocked.value) throw new Error(blocked.value)
    const p = projectId.value, current = crypto.randomUUID()
    operationId.value = current; lastAction.value = action; output.value = ''; error.value = ''
    try {
      const result = await gitApi.operation(p, action, { ...input, operationId: current })
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
    if (operationId.value) await gitApi.operation(projectId.value, 'cancel', { operationId: operationId.value })
  }
  /** Hides the result of the finished operation. */
  function dismiss() { if (!operationId.value) { error.value = ''; output.value = ''; lastAction.value = '' } }
  return { projectId, repository, branches, settings, coauthors, operationId, output, error, lastAction, blocked, start, stop, refresh, run, cancel, dismiss }
})
