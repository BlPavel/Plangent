import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { onServerEvent } from '@core/api/events'
import { errorText } from '@shared/utils/errorText'
import { planReviewApi as api } from './api'
import type { Detail, Review } from './types'

export function usePlanReview(project: Ref<string>, task: Ref<string>) {
  const reviews = ref<Review[]>([]), detail = ref<Detail | null>(null), selected = ref('')
  const error = ref(''), busy = ref(false)
  let alive = true, generation = 0, request = 0
  async function refresh() {
    const seq = ++request, gen = generation, p = project.value, t = task.value
    if (!p || !t) return
    try {
      const rows = await api.list(p, t)
      const id = rows.some(r => r.id === selected.value) ? selected.value : rows[0]?.id
      const value = id ? await api.detail(p, t, id) : null
      if (!alive || seq !== request || gen !== generation) return
      reviews.value = rows; selected.value = id || ''; detail.value = value
    } catch (cause) { if (alive && seq === request && gen === generation) error.value = errorText(cause) }
  }
  async function run(operation: () => Promise<Detail>) {
    if (busy.value) return false
    const gen = generation
    busy.value = true; error.value = ''
    try {
      const value = await operation()
      if (!alive || gen !== generation) return false
      ++request; selected.value = value.review.id; detail.value = value
      await refresh()
      return true
    } catch (cause) { if (alive && gen === generation) error.value = errorText(cause); return false }
    finally { if (alive && gen === generation) busy.value = false }
  }
  watch([project, task], () => {
    ++generation; ++request; reviews.value = []; detail.value = null; selected.value = ''; error.value = ''; busy.value = false
    void refresh()
  }, { immediate: true })
  watch(selected, () => { void refresh() })
  const stop = onServerEvent<{ type: string; taskId?: string }>(event => {
    if (event.type === 'events:connected' || (event.type === 'plan_review_updated' && event.taskId === task.value)) void refresh()
  })
  onScopeDispose(() => { alive = false; ++request; stop() })
  const counts = computed(() => {
    const result: Record<string, number> = {}
    for (const r of detail.value?.remarks ?? []) if (r.status === 'open') {
      for (const step of r.steps) if (!step.deleted) result[step.id] = (result[step.id] || 0) + 1
    }
    return result
  })
  return { reviews, detail, selected, error, busy, refresh, run, counts }
}

