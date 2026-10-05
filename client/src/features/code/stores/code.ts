import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { onServerEvent, subscribeCodeProject } from '@core/api/events'
import { codeApi, codeReviewsApi } from '../api'
import { countUnresolved, screenState } from '../utils/screen-state'
import type { CodeFile, TreeEntry, RepositoryInfo, GitChange, LineStat, CurrentReview, ReviewDetail, ReviewHistory, ReviewDraft, DraftPatch, DiffOptions, SearchOptions, SearchEvent, BaseChanges } from '../types'

export type CompareBase = 'head' | 'agent' | 'review'
/** «Продолжить» on the commit banner is remembered per review until HEAD moves again. */
const continued = new Map<string, string | null>()

export const useCodeStore = defineStore('code', () => {
  const projectId = ref<string | null>(null)
  const repository = ref<RepositoryInfo | null>(null)
  const changes = ref<GitChange[]>([])
  const stats = ref<Record<string, LineStat>>({})
  const trees = ref<Record<string, TreeEntry[]>>({})
  const files = ref<string[]>([])
  const includeIgnored = ref(false)
  const selectedPath = ref<string | null>(null)
  const file = ref<CodeFile | null>(null)
  const current = ref<CurrentReview | null>(null)
  const openedReviewId = ref<string | null>(null)
  const openedReview = ref<ReviewDetail | null>(null)
  const history = ref<ReviewHistory[]>([])
  const base = ref<CompareBase>('head')
  const baseRound = ref<string | null>(null)
  const baseData = ref<BaseChanges | null>(null)
  const continuedHead = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const watchError = ref<string | null>(null)
  const matches = ref<Extract<SearchEvent, { type: 'match' }>[]>([])
  const searchSummary = ref<Extract<SearchEvent, { type: 'done' }> | null>(null)
  const searching = ref(false)
  const searchError = ref<string | null>(null)
  const requests = new Map<string, AbortController>()
  let generation = 0
  let lifecycle = 0
  let historyLoaded = false
  let stopEvents: (() => void) | undefined
  let stopWatch: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const head = computed(() => repository.value?.head ?? null)
  const branch = computed(() => repository.value?.branch ?? null)
  const review = computed(() => openedReview.value?.review ?? current.value?.review ?? null)
  const items = computed(() => openedReview.value?.items ?? current.value?.items ?? [])
  const messages = computed(() => openedReview.value?.messages ?? current.value?.messages ?? [])
  const rounds = computed(() => openedReview.value?.rounds ?? current.value?.rounds ?? [])
  const readOnly = computed(() => openedReview.value?.read_only ?? false)

  // --- screen state, derived once from the server data --------------------------
  const screen = computed(() => screenState({ changes: changes.value.length, current: current.value, opened: openedReview.value }))
  const unresolved = computed(() => countUnresolved(items.value))
  /** The review of the branch the developer is on (not an opened historical one). */
  const liveReview = computed(() => current.value?.review ?? null)
  const agentWorking = computed(() => current.value?.agent_working ?? false)
  /** Comparison actually in effect: a historical review is only ever seen as «everything that entered it». */
  const effectiveBase = computed<CompareBase>(() => {
    if (openedReviewId.value) return 'review'
    if (base.value === 'agent') return liveReview.value && rounds.value.length ? 'agent' : 'head'
    if (base.value === 'review') return liveReview.value ? 'review' : 'head'
    return 'head'
  })
  const baseReviewId = computed(() => openedReviewId.value ?? liveReview.value?.id ?? null)
  const shownChanges = computed(() => (effectiveBase.value === 'head' ? changes.value : baseData.value?.changes ?? []))
  const shownStats = computed(() => (effectiveBase.value === 'head' ? stats.value : baseData.value?.stats ?? {}))
  /** Endpoints for the per-file diff when the comparison is not «against HEAD». */
  const diffEnds = computed(() => (effectiveBase.value === 'head' || !baseData.value ? null : { base: baseData.value.base, end: baseData.value.end }))
  /** Marks of the live review: viewed, or changed after it was viewed. Historical reviews carry no marks. */
  const viewedState = computed<Record<string, 'viewed' | 'changed'>>(() => {
    const result: Record<string, 'viewed' | 'changed'> = {}
    if (openedReviewId.value) return result
    for (const view of current.value?.file_views ?? []) result[view.path] = view.viewed ? 'viewed' : 'changed'
    return result
  })
  const viewedCount = computed(() => shownChanges.value.filter(change => viewedState.value[change.path] === 'viewed').length)
  /** The commit banner is offered once per HEAD: «Продолжить» silences it until the next commit. */
  const commitBannerShown = computed(() => screen.value === 'all-committed' || (screen.value === 'committed' && continuedHead.value !== head.value))
  /** An unfinished review of another branch (paused): the header offers it read-only. */
  const otherReview = computed(() => {
    const other = current.value?.other_reviews.find(candidate => candidate.status === 'open')
    return other ? { review: other, items: history.value.find(entry => entry.id === other.id)?.items ?? null } : null
  })
  const runningElsewhere = computed(() => current.value?.running_other_reviews ?? [])

  // Per-resource cancellation prevents stale responses after navigation or overlapping refreshes.
  async function read<T>(key: string, fetch: (p: string, signal: AbortSignal) => Promise<T>, commit: (value: T) => void) {
    const p = projectId.value
    if (!p) return
    requests.get(key)?.abort()
    const controller = new AbortController()
    requests.set(key, controller)
    try {
      const value = await fetch(p, controller.signal)
      if (!controller.signal.aborted && projectId.value === p) commit(value)
    } catch (cause) {
      if (!controller.signal.aborted) throw cause
    } finally { if (requests.get(key) === controller) requests.delete(key) }
  }
  const loadTree = (path = '') => read('tree:' + path, (p, signal) => codeApi.tree(p, path, includeIgnored.value, signal), value => { trees.value[path] = value })
  /** The selected file is gone from disk (deleted by the developer or the agent): not an error. */
  let fileMissing = false
  const loadFile = (path: string) => read('file', async (p, signal) => {
    fileMissing = false
    try { return await codeApi.file(p, path, signal) }
    catch (cause) {
      if (!signal.aborted && selectedPath.value === path) file.value = null
      if (/not found/i.test(String((cause as Error)?.message ?? cause))) { fileMissing = true; return null }
      throw cause
    }
  }, value => { file.value = value })
  async function selectFile(path: string | null) {
    selectedPath.value = path; file.value = null
    requests.get('file')?.abort()
    if (path !== null) await loadFile(path)
  }
  async function openReview(id: string | null) {
    openedReviewId.value = id; openedReview.value = null; baseData.value = null
    requests.get('detail')?.abort(); requests.get('base')?.abort()
    if (id) await read('detail', (p, signal) => codeReviewsApi.detail(p, id, signal), value => { openedReview.value = value })
    else base.value = 'head'
    await loadBase().catch(cause => { error.value = cause instanceof Error ? cause.message : String(cause) })
  }
  const loadBase = () => {
    const id = baseReviewId.value
    const kind = effectiveBase.value
    if (kind === 'head' || !id) { baseData.value = null; return Promise.resolve() }
    return read('base', (p, signal) => codeReviewsApi.baseChanges(p, id, kind, kind === 'agent' ? baseRound.value ?? undefined : undefined, signal), value => { baseData.value = value })
  }
  async function setBase(value: CompareBase, round: string | null = null) {
    base.value = value; baseRound.value = round; baseData.value = null
    requests.get('base')?.abort()
    try { await loadBase() } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  }
  function continueReview() {
    continuedHead.value = head.value
    if (liveReview.value) continued.set(liveReview.value.id, head.value)
  }
  const loadHistory = () => {
    historyLoaded = true
    return read('history', (p, signal) => codeReviewsApi.history(p, signal), value => { history.value = value })
  }
  async function refresh() {
    if (!projectId.value) return
    const revision = ++generation
    loading.value = true; error.value = null
    const paths = new Set(['', ...Object.keys(trees.value)])
    const jobs = [
      read('repository', (p, s) => codeApi.repository(p, s), value => { repository.value = value }),
      read('changes', (p, s) => codeApi.changes(p, s), value => { changes.value = value }),
      read('stats', (p, s) => codeApi.stats(p, s), value => { stats.value = value }),
      read('files', (p, s) => codeApi.files(p, includeIgnored.value, s), value => { files.value = value }),
      read('current', (p, s) => codeReviewsApi.current(p, s), value => { current.value = value }),
      ...[...paths].map(loadTree),
    ]
    if (selectedPath.value !== null) {
      const path = selectedPath.value
      jobs.push(loadFile(path))
    }
    if (openedReviewId.value) {
      const id = openedReviewId.value
      jobs.push(read('detail', (p, s) => codeReviewsApi.detail(p, id, s), value => { openedReview.value = value }))
    }
    if (historyLoaded) jobs.push(loadHistory())
    const results = await Promise.allSettled(jobs)
    if (revision !== generation) return
    // The comparison depends on the review and its rounds that were just re-read; a finished review drops it.
    if (!openedReviewId.value && base.value !== 'head' && effectiveBase.value === 'head') base.value = 'head'
    const followUps: Promise<void>[] = [loadBase()]
    if (current.value?.other_reviews.length && !historyLoaded) followUps.push(loadHistory())
    results.push(...await Promise.allSettled(followUps))
    if (revision !== generation) return
    // A deleted file stays open while its deletion shows in the changes; once nothing is left to show, it closes.
    const gone = selectedPath.value
    if (gone !== null && fileMissing && !shownChanges.value.some(change => change.path === gone)) { selectedPath.value = null; fileMissing = false }
    continuedHead.value = liveReview.value ? continued.get(liveReview.value.id) ?? null : null
    loading.value = false
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') error.value = failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
  }
  function stop() {
    generation++; lifecycle++; historyLoaded = false; clearTimeout(timer)
    stopWatch?.(); stopWatch = undefined
    stopEvents?.(); stopEvents = undefined
    for (const controller of requests.values()) controller.abort()
    requests.clear()
    projectId.value = null; loading.value = false; searching.value = false
    repository.value = null; changes.value = []; stats.value = {}; trees.value = {}; files.value = []
    selectedPath.value = null; file.value = null; current.value = null
    openedReviewId.value = null; openedReview.value = null; history.value = []
    base.value = 'head'; baseRound.value = null; baseData.value = null; continuedHead.value = null
    matches.value = []; searchSummary.value = null; error.value = null; watchError.value = null; searchError.value = null
  }
  async function start(p: string) {
    stop(); projectId.value = p
    stopEvents = onServerEvent<{ type: string; projectId?: string; error?: string }>(event => {
      if (event.type === 'events:disconnected') watchError.value = 'Connection lost; reconnecting'
      if (event.projectId !== projectId.value) return
      if (event.type === 'code:error') { watchError.value = event.error ?? 'Cannot watch project'; return }
      if (event.type === 'code:subscribed') watchError.value = null
      if (['code:subscribed', 'code:changed', 'code_review_updated', 'code_review_needs_decision'].includes(event.type)) {
        clearTimeout(timer); timer = setTimeout(() => void refresh(), 100)
      }
    })
    stopWatch = subscribeCodeProject(p)
    await refresh()
  }
  async function setIncludeIgnored(value: boolean) {
    includeIgnored.value = value
    await refresh()
  }
  function cancelSearch() {
    requests.get('search')?.abort(); requests.delete('search'); searching.value = false
  }
  function clearSearch() {
    cancelSearch(); matches.value = []; searchSummary.value = null; searchError.value = null
  }
  async function search(options: SearchOptions) {
    cancelSearch(); matches.value = []; searchSummary.value = null; searchError.value = null
    const p = projectId.value
    if (!p) return
    const controller = new AbortController()
    requests.set('search', controller); searching.value = true
    try {
      for await (const event of codeApi.search(p, options, controller.signal)) {
        if (controller.signal.aborted || projectId.value !== p) return
        if (event.type === 'match') matches.value.push(event)
        else searchSummary.value = event
      }
      if (!controller.signal.aborted && !searchSummary.value) throw new Error('Search stream ended before completion')
    } catch (cause) {
      if (!controller.signal.aborted) searchError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (requests.get('search') === controller) { requests.delete('search'); searching.value = false }
    }
  }
  async function mutate<T>(action: (p: string) => Promise<T>): Promise<T> {
    const p = projectId.value
    if (!p) throw new Error('No project selected')
    const active = lifecycle
    const result = await action(p)
    if (projectId.value === p && lifecycle === active) await refresh()
    return result
  }
  const addDraft = (data: ReviewDraft, origin: 'project' | 'task' = 'project', originId?: string) => mutate(p => codeReviewsApi.addDraft(p, data, origin, originId ?? p))
  const updateDraft = (r: string, i: string, data: DraftPatch) => mutate(p => codeReviewsApi.updateDraft(p, r, i, data))
  const removeItem = (r: string, i: string) => mutate(p => codeReviewsApi.removeItem(p, r, i))
  const makeGeneral = (r: string, i: string) => mutate(p => codeReviewsApi.makeGeneral(p, r, i))
  const addMessage = (r: string, i: string, data: { kind: 'text' | 'implement'; text: string; choice?: number }) => mutate(p => codeReviewsApi.addMessage(p, r, i, data))
  const removeMessage = (r: string, i: string, m: string) => mutate(p => codeReviewsApi.removeMessage(p, r, i, m))
  const closeItem = (r: string, i: string, resolution: 'accept' | 'answered' | 'reject' | 'reopen') => mutate(p => codeReviewsApi.closeItem(p, r, i, resolution))
  const sendRound = (r: string, sessionId: string, note?: string, itemIds?: string[]) => mutate(p => codeReviewsApi.sendRound(p, r, sessionId, note, itemIds))
  /** Stops the review's agent; threads it left without a reply return to the queue. */
  const stopAgent = (r: string) => mutate(p => codeReviewsApi.stop(p, r))
  const markViewed = (r: string, path: string, viewed: boolean) => mutate(p => codeReviewsApi.markViewed(p, r, path, viewed))
  /** «Просмотрено» flips the mark; before the first remark it opens the review of the branch by itself. */
  function toggleViewed(path: string, origin: 'project' | 'task' = 'project', originId?: string) {
    const want = viewedState.value[path] !== 'viewed'
    const live = liveReview.value
    return live ? markViewed(live.id, path, want) : mutate(p => codeReviewsApi.markViewedCurrent(p, path, want, origin, originId ?? p))
  }
  const finish = (r: string, mode: 'require_resolved' | 'carry' | 'close' = 'require_resolved') => mutate(p => codeReviewsApi.finish(p, r, mode))
  const removeReview = (r: string) => mutate(async p => {
    const active = lifecycle
    await codeReviewsApi.removeReview(p, r)
    if (lifecycle === active && openedReviewId.value === r) await openReview(null)
  })
  function diff(path: string, options: DiffOptions = {}, signal?: AbortSignal) {
    if (!projectId.value) throw new Error('No project selected')
    return codeApi.diff(projectId.value, path, options, signal)
  }
  onScopeDispose(stop)
  return { projectId, repository, head, branch, changes, stats, trees, files, includeIgnored, selectedPath, file, current, openedReviewId, openedReview, review, items, rounds, readOnly, history, loading, error, watchError,
    base, baseRound, baseData, screen, unresolved, liveReview, agentWorking, effectiveBase, shownChanges, shownStats, diffEnds, viewedState, viewedCount, commitBannerShown, otherReview, runningElsewhere, setBase, continueReview, toggleViewed,
    matches, searchSummary, searching, searchError, start, stop, refresh, loadTree, selectFile, openReview, loadHistory, setIncludeIgnored, search, cancelSearch, clearSearch, diff,
    messages, addDraft, updateDraft, removeItem, makeGeneral, addMessage, removeMessage, closeItem, sendRound, stopAgent, markViewed, finish, removeReview }
})

