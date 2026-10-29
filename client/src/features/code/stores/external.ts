import { ref } from 'vue'
import { defineStore } from 'pinia'
import { codeReviewsApi } from '../api'
import type { ExternalThreads } from '../types'

/** Colleagues' discussions from the branch's merge request. Pulled by the button only: there is no background sync. */
export const useExternalThreadsStore = defineStore('code-external-threads', () => {
  const projectId = ref(''), workspaceId = ref<string | undefined>(), data = ref<ExternalThreads | null>(null), loading = ref(false), error = ref('')
  let generation = 0

  function reset(p: string, workspace?: string) {
    if (p === projectId.value && workspace === workspaceId.value) return
    generation++
    projectId.value = p; workspaceId.value = workspace; data.value = null; error.value = ''; loading.value = false
  }
  async function pull() {
    const p = projectId.value, token = ++generation
    if (!p) return
    loading.value = true; error.value = ''
    try {
      const result = await codeReviewsApi.external(p, undefined, workspaceId.value)
      if (token === generation) data.value = result
    } catch (cause) { if (token === generation) error.value = cause instanceof Error ? cause.message : 'Не удалось подтянуть замечания' }
    finally { if (token === generation) loading.value = false }
  }
  async function reply(discussion: string, body: string) {
    const p = projectId.value
    const result = await codeReviewsApi.replyExternal(p, discussion, body, workspaceId.value)
    if (p === projectId.value) data.value = result
  }
  async function resolve(discussion: string, resolved: boolean) {
    const p = projectId.value
    const result = await codeReviewsApi.resolveExternal(p, discussion, resolved, workspaceId.value)
    if (p === projectId.value) data.value = result
  }
  async function editNote(discussion: string, note: number, body: string) {
    const p = projectId.value
    const result = await codeReviewsApi.editExternalNote(p, discussion, note, body, workspaceId.value)
    if (p === projectId.value) data.value = result
  }
  async function deleteNote(discussion: string, note: number) {
    const p = projectId.value
    const result = await codeReviewsApi.deleteExternalNote(p, discussion, note, workspaceId.value)
    if (p === projectId.value) data.value = result
  }
  return { projectId, data, loading, error, reset, pull, reply, resolve, editNote, deleteNote }
})
