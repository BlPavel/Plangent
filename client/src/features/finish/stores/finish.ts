import { ref, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { finishApi } from '../api'
import type { FinishRun, FinishOptions, FinishCommit, MrDraft } from '../types'
export const useFinishStore = defineStore('finish', () => {
 const projectId = ref(''), run = ref<FinishRun | null>(null), busy = ref(false), error = ref('')
 let version = 0
 const stop = onServerEvent<{ type: string; projectId?: string; run?: FinishRun }>(event => {
  if (event.type === 'finish:changed' && event.projectId === projectId.value && event.run) run.value = event.run
  if (event.type === 'events:connected' && projectId.value) void load(projectId.value, run.value?.id)
 })
 onScopeDispose(stop)
 async function load(p: string, id?: string) {
  const mine = ++version; if (projectId.value !== p || id && id !== run.value?.id) { run.value = null; busy.value = false }; projectId.value = p; error.value = ''
  try { const value = id ? await finishApi.get(p, id) : await finishApi.active(p); if (mine === version) run.value = value }
  catch (cause) { if (mine === version) error.value = String(cause) }
 }
 async function mutate(action: (p: string) => Promise<FinishRun | null>) {
  const p = projectId.value, mine = version
  if (!p || busy.value) return
  busy.value = true; error.value = ''
  try { const value = await action(p); if (mine === version) run.value = value; return value }
  catch (cause) {
   if (mine === version) { error.value = cause instanceof Error ? cause.message : String(cause); if (run.value) { const recovered = await finishApi.get(p, run.value.id).catch(() => null); if (mine === version && recovered) run.value = recovered } }
   throw cause
  } finally { if (mine === version) busy.value = false }
 }
 const start = (options: FinishOptions) => mutate(p => finishApi.start(p, options))
 const save = (commits: FinishCommit[]) => { const id = run.value!.id; return mutate(p => finishApi.commits(p, id, commits)) }
 const saveMr = (draft: MrDraft) => { const id = run.value!.id; return mutate(p => finishApi.mergeRequest(p, id, draft)) }
 const action = (name: string, data: object = {}) => { const id = run.value!.id; return mutate(p => finishApi.action(p, id, name, data)) }
 return { projectId, run, busy, error, load, start, save, saveMr, action }
})
