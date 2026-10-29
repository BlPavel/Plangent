import { ref, computed, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { finishApi } from '../api'
import type { FinishRun, FinishOptions, FinishCommit, MrDraft } from '../types'
const over = (run: FinishRun | null | undefined) => !run || ['complete', 'cancelled'].includes(run.status)
/** Finishes are kept per workspace ('' is the project's main place): several works finish at the same time, each in its own task. */
export const useFinishStore = defineStore('finish', () => {
 const projectId = ref(''), scope = ref(''), runs = ref<Record<string, FinishRun | null>>({}), busy = ref(false), error = ref('')
 const run = computed(() => runs.value[scope.value] ?? null)
 let version = 0
 const stop = onServerEvent<{ type: string; projectId?: string; run?: FinishRun }>(event => {
  if (event.type === 'finish:changed' && event.projectId === projectId.value && event.run) {
   const key = event.run.workspace_id ?? '', current = runs.value[key]
   if (!current || current.id === event.run.id || over(current)) runs.value = { ...runs.value, [key]: event.run }
  }
  if (event.type === 'events:connected' && projectId.value) void load(projectId.value, run.value?.id, scope.value || undefined)
 })
 onScopeDispose(stop)
 async function load(p: string, id?: string, workspaceId?: string) {
  const mine = ++version, key = workspaceId ?? ''
  if (projectId.value !== p) runs.value = {}
  if (scope.value !== key || projectId.value !== p || id && id !== runs.value[key]?.id) { busy.value = false; if (id && id !== runs.value[key]?.id) runs.value = { ...runs.value, [key]: null } }
  projectId.value = p; scope.value = key; error.value = ''
  try {
   const value = id ? await finishApi.get(p, id, workspaceId) : await finishApi.active(p, workspaceId)
   if (mine === version) runs.value = { ...runs.value, [key]: value }
  } catch (cause) { if (mine === version) error.value = String(cause) }
 }
 async function mutate(action: (p: string, workspaceId?: string) => Promise<FinishRun | null>) {
  const p = projectId.value, mine = version, key = scope.value, workspaceId = key || undefined
  if (!p || busy.value) return
  busy.value = true; error.value = ''
  try { const value = await action(p, workspaceId); if (mine === version) runs.value = { ...runs.value, [key]: value }; return value }
  catch (cause) {
   if (mine === version) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    const current = runs.value[key]
    if (current) { const recovered = await finishApi.get(p, current.id, workspaceId).catch(() => null); if (mine === version && recovered) runs.value = { ...runs.value, [key]: recovered } }
   }
   throw cause
  } finally { if (mine === version) busy.value = false }
 }
 const start = (options: FinishOptions) => mutate((p, w) => finishApi.start(p, options, w))
 const save = (commits: FinishCommit[]) => { const id = run.value!.id; return mutate((p, w) => finishApi.commits(p, id, commits, w)) }
 const saveMr = (draft: MrDraft) => { const id = run.value!.id; return mutate((p, w) => finishApi.mergeRequest(p, id, draft, w)) }
 const action = (name: string, data: object = {}) => { const id = run.value!.id; return mutate((p, w) => finishApi.action(p, id, name, data, w)) }
 return { projectId, scope, run, runs, busy, error, load, start, save, saveMr, action }
})
