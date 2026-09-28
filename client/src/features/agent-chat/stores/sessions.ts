import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import { platform } from '@core/platform'
export interface ChatSession {
  id: string; project_id: string; task_id: string | null; agent_id: string; model: string;
  title: string; status: string; reason: string; policy: string; role: string;
  metadata: Record<string, unknown>;
}
export interface ChatPayload {
  text?: string; toolCallId?: string; title?: string; status?: string; rawOutput?: unknown;
  content?: { type: string; path?: string; oldText?: string; newText?: string; content?: { text?: string } }[];
  entries?: { status: string; content: string }[];
  availableCommands?: { name: string; description: string }[];
  file?: string; line?: number; severity?: string; message?: string;
  verdict?: string;
}
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
    if (session.status === 'waiting' && (index < 0 || sessions.value[index].status !== 'waiting')) platform.notify?.(session.title, session.reason || 'Агент ждёт вашего ответа')
    if (index < 0) sessions.value.unshift(session)
    else sessions.value[index] = session
    if (snapshots.value[session.id]) snapshots.value[session.id].session = session
  }
  async function load(id: string) {
    const snap = await api.get<ChatSnapshot>(`/agent-sessions/${id}`)
    snapshots.value[id] = snap
    put(snap.session)
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
  function waiting(projectId: string) { return sessions.value.filter(s => s.project_id === projectId && s.status === 'waiting').length }
  return { sessions, snapshots, connect, load, put, waiting }
})
export function statusLabel(status: string) {
  return ({ starting: 'Запускается', thinking: '● Думает', waiting: '! Ждёт вас', ready: '○ Готов', complete: '✓ Завершён', error: '✕ Ошибка' } as Record<string, string>)[status] ?? status
}
