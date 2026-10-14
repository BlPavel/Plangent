import { ref } from 'vue'
import { defineStore } from 'pinia'
import { codeReviewsApi } from '../api'
import type { ExternalThreads } from '../types'

/** Colleagues' discussions from the branch's merge request. Pulled by the button only: there is no background sync. */
export const useExternalThreadsStore = defineStore('code-external-threads', () => {
  const projectId = ref(''), data = ref<ExternalThreads | null>(null), loading = ref(false), error = ref('')
  let generation = 0

  function reset(p: string) {
    if (p === projectId.value) return
    generation++
    projectId.value = p; data.value = null; error.value = ''; loading.value = false
  }
  async function pull() {
    const p = projectId.value, token = ++generation
    if (!p) return
    loading.value = true; error.value = ''
    try {
      const result = await codeReviewsApi.external(p)
      if (token === generation) data.value = result
    } catch (cause) { if (token === generation) error.value = cause instanceof Error ? cause.message : 'Не удалось подтянуть замечания' }
    finally { if (token === generation) loading.value = false }
  }
  async function reply(discussion: string, body: string) {
    const p = projectId.value
    const result = await codeReviewsApi.replyExternal(p, discussion, body)
    if (p === projectId.value) data.value = result
  }
  return { projectId, data, loading, error, reset, pull, reply }
})
