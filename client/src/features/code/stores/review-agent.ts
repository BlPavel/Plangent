
import { tasksEndpoints } from '@features/tasks'
import { agentChatEndpoints } from '@features/agent-chat'
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useChatStore, type ChatSession, type NewChatRequest } from '@features/agent-chat'
import { useCodeStore } from './code'
import { threadState } from '../utils/thread'

/** Sessions that can take a round: the review's own fixer, or the chat of the work (errand or task) it belongs to. */
const FIXERS = ['code-fixer', 'errand', 'task-chat']

/** Statuses in which the agent is busy with a turn (a permission request shows in `permissions`). */
const BUSY = ['starting', 'thinking']

/**
 * The agent of the open review. A review has one agent session behind the scenes: it is set up
 * (agent, model, permissions) on the first «Отправить» and receives every later batch. The
 * developer talks to it in the items' threads; its raw log is the «Журнал».
 */
export const useReviewAgentStore = defineStore('code-review-agent', () => {
  const code = useCodeStore()
  const chats = useChatStore()
  /** Items waiting for the agent to be set up (null: everything pending); shows the setup form. */
  const setup = ref<{ ids: string[] | null } | null>(null)
  const starting = ref<string | null>(null)
  const sending = ref(false)
  /** A batch has been handed over but the agent has not started thinking yet: no gap where it looks idle. */
  const awaiting = ref(false)
  let awaitTimer: ReturnType<typeof setTimeout> | undefined
  const error = ref('')
  /**
   * Проверка of a work: by default the work's own chat (its executor, with all the context) takes the
   * remarks; «Другой агент» sets up a separate fixer in the work's folder.
   */
  const work = ref<{ projectId: string; taskId: string; workspaceId?: string } | null>(null)

  /** The session of the latest round that still exists, or the one being started. */
  const sessionId = computed(() => {
    if (starting.value) return starting.value
    const rounds = [...code.rounds].reverse()
    return rounds.find(r => r.session_id && chats.sessions.some(s => s.id === r.session_id && FIXERS.includes(s.role)))?.session_id ?? null
  })
  const session = computed<ChatSession | null>(() => chats.sessions.find(s => s.id === sessionId.value) ?? null)
  const snapshot = computed(() => (sessionId.value ? chats.snapshots[sessionId.value] ?? null : null))
  const permissions = computed(() => snapshot.value?.permissions ?? [])
  const busy = computed(() => BUSY.includes(session.value?.status ?? '') || permissions.value.length > 0 || code.agentWorking || awaiting.value)
  const stopping = ref(false)
  /** The item the agent said it works on (start_review_item) during the current turn. */
  const focusItem = computed(() => {
    const events = snapshot.value?.events ?? []
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'user') return null
      if (events[i].type === 'review_focus') return String((events[i].payload as { item_id?: unknown }).item_id ?? '')
    }
    return null
  })

  /** Marks the turn as expected until the session reports «thinking» (or a while passes, so a lost event cannot stick). */
  function expectTurn() {
    clearTimeout(awaitTimer)
    if (BUSY.includes(session.value?.status ?? '')) { awaiting.value = false; return }
    awaiting.value = true
    awaitTimer = setTimeout(() => { awaiting.value = false; if (starting.value && !hasRound(starting.value)) starting.value = null }, 20_000)
  }
  const hasRound = (id: string) => code.rounds.some(r => r.session_id === id)
  // «ready» and «starting» are still the wait; anything else means the turn began (or ended without beginning).
  watch(() => session.value?.status, status => { if (awaiting.value && !['ready', 'starting', undefined].includes(status)) { awaiting.value = false; clearTimeout(awaitTimer) } })
  // The new session stays «the review's agent» until its round is known: no flash of the agent picker in between.
  watch(() => code.rounds.length, () => { if (starting.value && hasRound(starting.value)) starting.value = null })

  void chats.connect()
  // The snapshot carries permission requests and focus events; it follows the review's session.
  watch(sessionId, id => { if (id && !chats.snapshots[id]) void chats.load(id).catch(() => undefined) }, { immediate: true })

  /** A work's chat takes only explicit items: everything waiting to be sent. */
  const pendingIds = () => code.items.filter(i => i.origin_id === work.value?.taskId && !i.outdated && ['draft', 'queued'].includes(threadState(i, code.messages))).map(i => i.id)
  /** Sends the batch (or one thread); without an agent yet it asks to set one up first (a work's chat is there already). */
  async function send(ids: string[] | null = null) {
    error.value = ''
    const review = code.review
    if (!review) return
    if (!sessionId.value && !work.value) { setup.value = { ids }; return }
    sending.value = true
    try {
      let id = sessionId.value
      if (!id && work.value) {
        const chat = await tasksEndpoints.postProjectsByProjectIdTasksByTaskIdChat({ params: { projectId: work.value.projectId, taskId: work.value.taskId }, body: {} })
        chats.put(chat); id = chat.id
      }
      const role = chats.sessions.find(s => s.id === id)?.role
      await code.sendRound(review.id, id!, '', ids ?? (role === 'code-fixer' ? undefined : pendingIds()))
      expectTurn()
    }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
    finally { sending.value = false }
  }

  /** Setup form submitted: creates the agent session and sends the waiting batch to it. */
  async function start(projectId: string, { content, ...options }: NewChatRequest, defaultNote: string, only?: string[] | null) {
    const review = code.review
    if (!review) return
    // Started from the agent bar there is no setup form: `only` names the items (null — all waiting ones).
    const ids = only !== undefined ? only : setup.value?.ids ?? null
    error.value = ''
    sending.value = true
    let created: ChatSession | null = null
    try {
      created = await agentChatEndpoints.postAgentSessions({ params: {  }, body: { project_id: projectId, role: 'code-fixer', ...options, ...(work.value?.workspaceId ? { workspace_id: work.value.workspaceId } : {}) } })
      chats.put(created)
      // The status «Подключается» is visible at once: connecting to the agent takes a while.
      starting.value = created.id
      setup.value = null
      void chats.load(created.id).catch(() => undefined)
      const note = content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim()
      await code.sendRound(review.id, created.id, note === defaultNote ? '' : note, ids ?? undefined)
      expectTurn()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      setup.value = { ids }
      starting.value = null
      // A session that never got a round would be an orphan nobody can find.
      if (created) await chats.remove(created.id).catch(() => undefined)
    } finally { sending.value = false; if (starting.value && hasRound(starting.value)) starting.value = null }
  }

  async function answerPermission(permissionId: string, optionId: string) {
    const id = sessionId.value
    if (!id) return
    try { await agentChatEndpoints.postAgentSessionsByIdByAction({ params: { id: id, action: "permission" }, body: { permissionId, optionId } }); await chats.load(id) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  }

  /** Interrupts the agent (a hung one is shut down); unanswered threads can then be sent again. */
  async function stop() {
    const review = code.review
    if (!review || stopping.value) return
    error.value = ''
    stopping.value = true
    try {
      await code.stopAgent(review.id)
      if (sessionId.value) await chats.load(sessionId.value).catch(() => undefined)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
    finally { stopping.value = false }
  }

  return { work, setup, sending, awaiting, stopping, error, sessionId, session, busy, permissions, focusItem, send, start, answerPermission, stop }
})
