import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import { platform } from '@core/platform'
import type { AgentOptionsSource } from '../utils/agent-options'
export interface ChatSession {
  id: string; project_id: string; task_id: string | null; agent_id: string; model: string;
  title: string; status: string; reason: string; policy: string; role: string;
  metadata: Record<string, unknown>; created_at?: string; updated_at?: string;
}
export interface ChatPayload {
  link?: string;
  text?: string; toolCallId?: string; title?: string; status?: string; kind?: string; rawOutput?: unknown;
  content?: { type: string; path?: string; oldText?: string; newText?: string; content?: { text?: string } }[];
  entries?: { status: string; content: string }[];
  availableCommands?: { name: string; description: string }[];
  file?: string; line?: number; severity?: string; message?: string;
  verdict?: string; summary?: string; question?: string; note?: string;
  /** propose_library_change: the proposal the card shows. */
  proposal_id?: string;
  /** The user message also carried Plangent's hidden briefing. */
  briefing?: boolean;
}
export interface LimitWindow { id: string; label: string; percent: number; resetsAt: number | null }
export interface AgentLimits { agentId: string; at: number; windows: LimitWindow[]; error?: string }
export interface ChatEvent { seq: number; session_id: string; type: string; payload: ChatPayload }
export interface ChatSnapshot {
  session: ChatSession; events: ChatEvent[];
  queue: { id: string; content: string }[];
  streaming: { text: string; type: string } | null;
  permissions: { permissionId: string; toolCall: { title: string }; options: { optionId: string; name: string; kind: string }[] }[];
}
export const useChatStore = defineStore('agent-chat', () => {
  const sessions = ref<ChatSession[]>([])
  const snapshots = ref<Record<string, ChatSnapshot>>({})
  let socket: WebSocket | undefined
  let connecting = false
  function put(session: ChatSession) {
    const index = sessions.value.findIndex(s => s.id === session.id)
    const previous = index < 0 ? undefined : sessions.value[index].status
    if ((session.status === 'waiting' || session.status === 'error') && previous !== session.status) {
      // A task's chat opens on click right in that task (see features/tasks taskTarget).
      const target = session.task_id ? `/task/${session.task_id}?project=${session.project_id}&session=${session.id}` : undefined
      platform.notify?.(session.title, session.reason || (session.status === 'error' ? 'Агент завершился с ошибкой' : 'Агент ждёт вашего ответа'), target)
    }
    if (index < 0) sessions.value.unshift(session)
    else sessions.value[index] = session
    if (snapshots.value[session.id]) snapshots.value[session.id].session = session
  }
  async function load(id: string) {
    const snap = await api.get<ChatSnapshot>(`/agent-sessions/${id}`)
    snapshots.value[id] = snap
    put(snap.session)
  }
  function drop(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id)
    delete snapshots.value[id]
  }
  async function remove(id: string) {
    await api.delete(`/agent-sessions/${id}`)
    drop(id)
  }
  async function connect() {
    if (connecting || socket) return
    connecting = true
    try {
      sessions.value = await api.get<ChatSession[]>('/agent-sessions')
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`)
      socket.onopen = () => {
        void api.get<ChatSession[]>('/agent-sessions').then(rows => { sessions.value = rows })
        for (const id of Object.keys(snapshots.value)) void load(id)
      }
      socket.onmessage = message => {
        const event = JSON.parse(message.data)
        if (event.type === 'agent_session') put(event.session)
        if (event.type === 'agent_session_deleted') drop(event.sessionId)
        const id = event.sessionId ?? event.event?.session_id ?? event.session?.id
        const snap = snapshots.value[id]
        if (!snap) return
        if (event.type === 'agent_delta') {
          if (!snap.streaming || snap.streaming.type !== event.kind) snap.streaming = { type: event.kind, text: '' }
          snap.streaming.text += event.text
        } else if (event.type === 'agent_event') {
          if (!snap.events.some(e => e.seq === event.event.seq)) snap.events.push(event.event)
          if (['assistant', 'thought'].includes(event.event.type)) snap.streaming = null
          if (event.event.type === 'permission') snap.permissions.push(event.event.payload)
          if (event.event.type === 'permission_result') snap.permissions = snap.permissions.filter(p => p.permissionId !== event.event.payload.permissionId)
        } else if (event.type === 'agent_queue') { void load(id) }
      }
      socket.onclose = () => { socket = undefined; setTimeout(() => void connect(), 2000) }
    } catch { setTimeout(() => void connect(), 2000) }
    finally { connecting = false }
  }
  // Subscription limits are per account, so they live per agent, not per chat.
  const limits = ref<Record<string, AgentLimits>>({})
  const inflight = new Map<string, Promise<void>>()
  function fetchLimits(agentId: string, force = false) {
    if (!agentId) return Promise.resolve()
    if (inflight.has(agentId)) return inflight.get(agentId)!
    const job = api.get<AgentLimits>(`/agents/${agentId}/limits${force ? '?refresh=1' : ''}`)
      .then(value => { limits.value[agentId] = value })
      .catch(() => {})
      .finally(() => inflight.delete(agentId))
    inflight.set(agentId, job)
    return job
  }
  // Models/modes/reasoning levels an agent offers, as it reported them (first fetch may take a few seconds).
  // `refresh` starts the agent again; 'cached' only reads what is already known and never starts it.
  const agentOptions = ref<Record<string, AgentOptionsSource | { error: string }>>({})
  const optionJobs = new Map<string, Promise<void>>()
  function fetchAgentOptions(agentId: string, refresh: boolean | 'cached' = false) {
    if (!agentId) return Promise.resolve()
    if (optionJobs.has(agentId)) return optionJobs.get(agentId)!
    const query = refresh === 'cached' ? '?cached=1' : refresh ? '?refresh=1' : ''
    const job = api.get<AgentOptionsSource | null>(`/agents/${agentId}/acp-options${query}`)
      .then(value => { if (value) agentOptions.value[agentId] = value })
      .catch(e => { agentOptions.value[agentId] = { error: e instanceof Error ? e.message : String(e) } })
      .finally(() => optionJobs.delete(agentId))
    optionJobs.set(agentId, job)
    return job
  }
  return { sessions, snapshots, limits, agentOptions, connect, load, put, remove, fetchLimits, fetchAgentOptions }
})
export function statusLabel(status: string) {
  return ({ starting: 'Подключается', thinking: 'Думает', waiting: 'Ждёт вас', ready: 'Готов', complete: 'Завершён', error: 'Ошибка' } as Record<string, string>)[status] ?? status
}
/** Maps a session status onto the shared .status-badge colour classes. */
export function statusTone(status: string) {
  return ({ starting: 'neutral', thinking: 'open', waiting: 'progress', ready: 'done', complete: 'done', error: 'danger' } as Record<string, string>)[status] ?? 'neutral'
}
