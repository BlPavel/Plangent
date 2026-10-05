import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@core/api'
import { useChatStore, type ChatSession, type NewChatRequest } from '@features/agent-chat'
import { useCodeStore } from './code'

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
  const error = ref('')

  /** The session of the latest round that still exists, or the one being started. */
  const sessionId = computed(() => {
    if (starting.value) return starting.value
    const rounds = [...code.rounds].reverse()
    return rounds.find(r => r.session_id && chats.sessions.some(s => s.id === r.session_id))?.session_id ?? null
  })
  const session = computed<ChatSession | null>(() => chats.sessions.find(s => s.id === sessionId.value) ?? null)
  const snapshot = computed(() => (sessionId.value ? chats.snapshots[sessionId.value] ?? null : null))
  const permissions = computed(() => snapshot.value?.permissions ?? [])
  const busy = computed(() => BUSY.includes(session.value?.status ?? '') || permissions.value.length > 0 || code.agentWorking)
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

  void chats.connect()
  // The snapshot carries permission requests and focus events; it follows the review's session.
  watch(sessionId, id => { if (id && !chats.snapshots[id]) void chats.load(id).catch(() => undefined) }, { immediate: true })

  /** Sends the batch (or one thread); without an agent yet it asks to set one up first. */
  async function send(ids: string[] | null = null) {
    error.value = ''
    const review = code.review
    if (!review) return
    if (!sessionId.value) { setup.value = { ids }; return }
    sending.value = true
    try { await code.sendRound(review.id, sessionId.value, '', ids ?? undefined) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
    finally { sending.value = false }
  }

  /** Setup form submitted: creates the agent session and sends the waiting batch to it. */
  async function start(projectId: string, { content, ...options }: NewChatRequest, defaultNote: string) {
    const review = code.review
    if (!review) return
    const ids = setup.value?.ids ?? null
    error.value = ''
    sending.value = true
    let created: ChatSession | null = null
    try {
      created = await api.post<ChatSession>('/agent-sessions', { project_id: projectId, role: 'code-fixer', ...options })
      chats.put(created)
      // The status «Подключается» is visible at once: connecting to the agent takes a while.
      starting.value = created.id
      setup.value = null
      void chats.load(created.id).catch(() => undefined)
      const note = content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim()
      await code.sendRound(review.id, created.id, note === defaultNote ? '' : note, ids ?? undefined)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      setup.value = { ids }
      // A session that never got a round would be an orphan nobody can find.
      if (created) await chats.remove(created.id).catch(() => undefined)
    } finally { starting.value = null; sending.value = false }
  }

  async function answerPermission(permissionId: string, optionId: string) {
    const id = sessionId.value
    if (!id) return
    try { await api.post(`/agent-sessions/${id}/permission`, { permissionId, optionId }); await chats.load(id) }
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

  return { setup, sending, stopping, error, sessionId, session, busy, permissions, focusItem, send, start, answerPermission, stop }
})
