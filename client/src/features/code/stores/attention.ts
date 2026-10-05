import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent } from '@core/api/events'
import { codeApi, codeReviewsApi } from '../api'
import type { ReviewAttention } from '../types'

/** Per project: items waiting for the developer's decision and how many files differ from HEAD (entry points outside the Code screen). */
export const useCodeAttentionStore = defineStore('codeAttention', () => {
  const items = ref<ReviewAttention[]>([])
  const errors = ref<Record<string, string>>({})
  const changed = ref<Record<string, number>>({})
  let stopEvents: (() => void) | undefined
  const requests = new Map<string, AbortController>()
  const changeRequests = new Map<string, AbortController>()
  const projects = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  async function load(projectId: string) {
    projects.add(projectId)
    requests.get(projectId)?.abort()
    const controller = new AbortController()
    requests.set(projectId, controller)
    try {
      const data = await codeReviewsApi.attention(projectId, controller.signal)
      if (controller.signal.aborted) return
      items.value = [...items.value.filter(i => i.project_id !== projectId), ...data]
      delete errors.value[projectId]
    } catch (error) {
      if (!controller.signal.aborted) errors.value[projectId] = error instanceof Error ? error.message : String(error)
    } finally { if (requests.get(projectId) === controller) requests.delete(projectId) }
  }
  /** Number of changed files; a failed read keeps the last known number. */
  async function loadChanged(projectId: string) {
    changeRequests.get(projectId)?.abort()
    const controller = new AbortController()
    changeRequests.set(projectId, controller)
    try {
      const list = await codeApi.changes(projectId, controller.signal)
      if (!controller.signal.aborted) changed.value = { ...changed.value, [projectId]: list.length }
    } catch { /* keep the last known number */ }
    finally { if (changeRequests.get(projectId) === controller) changeRequests.delete(projectId) }
  }
  const scheduleChanged = (projectId: string) => {
    clearTimeout(timers.get(projectId))
    timers.set(projectId, setTimeout(() => void loadChanged(projectId), 500))
  }
  function start(projectIds: string[]) {
    const wanted = new Set(projectIds)
    for (const project of projects) if (!wanted.has(project)) {
      projects.delete(project); requests.get(project)?.abort(); requests.delete(project); delete errors.value[project]
      changeRequests.get(project)?.abort(); changeRequests.delete(project); clearTimeout(timers.get(project)); timers.delete(project)
    }
    items.value = items.value.filter(i => wanted.has(i.project_id))
    for (const project of wanted) void load(project)
    if (stopEvents) return
    stopEvents = onServerEvent<{ type: string; projectId?: string }>(event => {
      if (event.type === 'events:connected') { for (const p of projects) { void load(p); void loadChanged(p) } }
      if (event.projectId && projects.has(event.projectId) && ['code_review_updated', 'code_review_needs_decision'].includes(event.type)) void load(event.projectId)
    })
  }
  function stop() {
    stopEvents?.(); stopEvents = undefined
    for (const controller of [...requests.values(), ...changeRequests.values()]) controller.abort()
    for (const timer of timers.values()) clearTimeout(timer)
    requests.clear(); changeRequests.clear(); timers.clear(); projects.clear()
  }
  onScopeDispose(stop)
  const forProject = (p: string) => items.value.filter(i => i.project_id === p)
  const forTask = (taskId: string) => items.value.filter(i => i.origin === 'task' && i.origin_id === taskId)
  const countFor = (list: ReviewAttention[]) => list.reduce((sum, i) => sum + i.count, 0)
  const count = computed(() => countFor(items.value))
  return { items, errors, changed, count, countFor, forProject, forTask, load, loadChanged, scheduleChanged, start, stop }
})
