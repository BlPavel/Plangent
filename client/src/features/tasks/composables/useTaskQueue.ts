import { computed, ref, type InjectionKey, type Ref } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { OrchestratorQueueSession, PlanStep, QueueStage, TaskQueue } from '@core/models'
import type { MenuItem } from '@shared/ui/AppMenu.vue'

export type NewQueueSession = Pick<OrchestratorQueueSession, 'points' | 'agentId' | 'queueMode' | 'permissionPolicy' | 'model' | 'reasoningEffort'>
/** Where to put sessions: a new stage at the end, or an existing stage (runs in parallel with it). */
export type StageTarget = 'new' | string
export type SessionAction = 'complete' | 'execute' | 'skip' | 'restart'

const clone = (stages: QueueStage[]): QueueStage[] => stages.map(st => ({ ...st, sessions: st.sessions.map(s => ({ ...s })) }))
const newStage = (sessions: OrchestratorQueueSession[]): QueueStage => ({ id: crypto.randomUUID(), pauseAfter: false, sessions })
const draftSession = (s: NewQueueSession): OrchestratorQueueSession => ({ ...s, id: crypto.randomUUID(), status: 'queued' })

/**
 * The task's execution queue as the server keeps it. While the queue runs it is frozen;
 * every edit (only allowed when not running) sends the whole stage layout back.
 */
export function useTaskQueue(projectId: Ref<string | undefined>, taskId: Ref<string | undefined>) {
  const app = useAppStore()
  const queue = ref<TaskQueue | null>(null)
  const base = computed(() => `/projects/${projectId.value}/tasks/${taskId.value}/queue`)

  const stages = computed(() => queue.value?.stages ?? [])
  const sessions = computed(() => stages.value.flatMap(st => st.sessions))
  const history = computed(() => queue.value?.history ?? [])
  // Current and earlier runs: any of them can be opened to read its agent's chat.
  const allSessions = computed(() => [...sessions.value, ...history.value.flatMap(r => r.stages.flatMap(st => st.sessions))])
  const frozen = computed(() => queue.value?.status === 'running' || queue.value?.status === 'paused')
  const pending = computed(() => sessions.value.filter(s => s.status !== 'complete'))
  // Points taken by a session that has not finished yet (they cannot be queued twice).
  const assigned = computed(() => new Set(pending.value.flatMap(s => s.points)))

  async function load() {
    if (!projectId.value || !taskId.value) return
    try { queue.value = await api.get<TaskQueue>(base.value) } catch (e) { app.toast(String(e), 'error') }
  }

  async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    try { return await job() } catch (e) { app.toast(e instanceof Error ? e.message : String(e), 'error'); await load() }
  }

  // Optimistic: the new layout shows at once, the server's answer replaces it.
  async function setStages(next: QueueStage[]) {
    if (!queue.value || frozen.value) return
    queue.value = { ...queue.value, stages: next }
    const saved = await run(() => api.put<TaskQueue>(base.value, { stages: next }))
    if (saved) queue.value = saved
  }

  function edit(change: (stages: QueueStage[]) => void) {
    const next = clone(stages.value)
    change(next)
    return setStages(next.filter(st => st.sessions.length))
  }

  function take(list: QueueStage[], sessionId: string) {
    for (const st of list) {
      const i = st.sessions.findIndex(s => s.id === sessionId)
      if (i >= 0) return st.sessions.splice(i, 1)[0]
    }
  }

  const addSessions = (added: NewQueueSession[], target: StageTarget) => edit(list => {
    const drafts = added.map(draftSession)
    const stage = target !== 'new' && list.find(st => st.id === target)
    if (stage) stage.sessions.push(...drafts)
    else list.push(newStage(drafts))
  })

  /**
   * Lay the plan out as stages: every step is its own stage (a fresh agent each, in plan order),
   * and neighbouring steps with the same @parallel:<group> mark share one stage and run together.
   */
  const addFromPlan = (steps: PlanStep[], settings: Omit<NewQueueSession, 'points'>) => edit(list => {
    let group: { name: string; stage: QueueStage } | null = null
    for (const step of steps) {
      if (!step.id) continue
      const session = draftSession({ ...settings, points: [step.id] })
      if (step.parallelGroup && group?.name === step.parallelGroup) { group.stage.sessions.push(session); continue }
      const stage = newStage([session])
      list.push(stage)
      group = step.parallelGroup ? { name: step.parallelGroup, stage } : null
    }
  })

  const removeSession = (id: string) => edit(list => { take(list, id) })
  const removeStage = (id: string) => edit(list => { list.splice(list.findIndex(st => st.id === id), 1) })
  const updateSession = (id: string, patch: Partial<OrchestratorQueueSession>) => edit(list => {
    const s = list.flatMap(st => st.sessions).find(x => x.id === id)
    if (s) Object.assign(s, patch)
  })
  const updateStage = (id: string, patch: Partial<Pick<QueueStage, 'pauseAfter'>>) => edit(list => {
    const st = list.find(x => x.id === id)
    if (st) Object.assign(st, patch)
  })
  /** Move a session into a stage (parallel with it) or into a new stage inserted at `index`. */
  const moveSession = (id: string, to: { stageId: string } | { index: number }) => edit(list => {
    const s = take(list, id)
    if (!s) return
    if ('stageId' in to) {
      const stage = list.find(st => st.id === to.stageId)
      if (stage) { stage.sessions.push(s); return }
    }
    // Emptied stages are still in the list here, so `index` refers to the layout the developer saw.
    list.splice('index' in to ? to.index : list.length, 0, newStage([s]))
  })
  /** Run a whole stage in parallel with another one (it joins the target's place in the order). */
  const mergeStages = (sourceId: string, targetId: string) => edit(list => {
    const source = list.find(st => st.id === sourceId)
    const target = list.find(st => st.id === targetId)
    if (!source || !target || source === target) return
    target.sessions.push(...source.sessions)
    target.pauseAfter ||= source.pauseAfter
    source.sessions = []
  })
  /** Take a session out of its parallel stage into its own stage right after it. */
  const splitSession = (id: string) => edit(list => {
    const i = list.findIndex(st => st.sessions.some(s => s.id === id))
    if (i < 0 || list[i].sessions.length < 2) return
    list.splice(i + 1, 0, newStage([take(list, id)!]))
  })
  const clearFinished = () => edit(list => {
    for (const st of list) st.sessions = st.sessions.filter(s => s.status !== 'complete')
  })
  const clearAll = () => setStages([])

  async function command(path: string, body?: unknown) {
    const next = await run(() => api.post<TaskQueue>(`${base.value}/${path}`, body ?? {}))
    if (next) queue.value = next
  }
  const start = () => command('start')
  const stop = () => command('stop')
  const pauseAfterStage = (on: boolean) => command('pause', { on })
  const resume = () => command('resume')
  const clearHistory = () => command('clear-history')
  const sessionAction = (id: string, action: SessionAction) => command(`sessions/${id}/${action}`)

  function applyEvent(event: { type: string; taskId?: unknown; queue?: unknown }) {
    if (event.type === 'queue_updated' && event.taskId === taskId.value) queue.value = event.queue as TaskQueue
  }

  return {
    queue, stages, sessions, history, allSessions, frozen, assigned, load, applyEvent,
    addSessions, addFromPlan, removeSession, removeStage, updateSession, updateStage, moveSession, mergeStages, splitSession, clearFinished, clearAll,
    start, stop, pauseAfterStage, resume, clearHistory, sessionAction,
  }
}

export type TaskQueueController = ReturnType<typeof useTaskQueue>
export const TaskQueueKey: InjectionKey<TaskQueueController> = Symbol('task-queue')

/** Rare actions on a session that is being executed — kept out of sight in a "⋯" menu. */
export function liveSessionMenu(queue: TaskQueueController, s: OrchestratorQueueSession): MenuItem[] {
  return [
    ...(s.queueMode === 'review_first' && s.status !== 'running' ? [{ label: 'Приступить к выполнению', action: () => queue.sessionAction(s.id, 'execute') }] : []),
    { label: 'Считать выполненным', hint: 'Агент сделал работу, но не отчитался — отметить шаги и идти дальше', action: () => queue.sessionAction(s.id, 'complete') },
    { label: 'Начать заново', hint: 'Остановить агента и запустить шаг с чистым контекстом', action: () => queue.sessionAction(s.id, 'restart') },
    { separator: true },
    { label: 'Пропустить шаг', hint: 'Остановить агента; шаги останутся невыполненными, очередь пойдёт дальше', danger: true, action: () => queue.sessionAction(s.id, 'skip') },
  ]
}
