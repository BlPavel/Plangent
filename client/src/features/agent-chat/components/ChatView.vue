<template>
  <section v-if="snap" class="chat">
    <header class="chat-head">
      <div class="chat-title">
        <strong :title="snap.session.title">{{ snap.session.title }}</strong>
        <span v-if="agentName" class="chat-agent">{{ agentName }}</span>
      </div>
      <span class="status-badge" :class="statusTone(snap.session.status)">{{ statusLabel(snap.session.status) }}</span>
    </header>

    <div v-if="snap.session.status === 'error'" class="banner banner-error">
      <div class="banner-text">{{ snap.session.reason || 'Агент завершился с ошибкой' }}
        <span class="banner-hint">Если нужен вход, выполните команду входа CLI во вкладке «Терминал».</span>
      </div>
      <AppButton size="sm" @click="action('retry')">Повторить</AppButton>
      <AppButton size="sm" @click="newContext">Новый чат с контекстом</AppButton>
    </div>
    <div v-else-if="snap.session.status === 'waiting' && snap.session.reason && !snap.permissions.length" class="banner banner-wait">
      <div class="banner-text">{{ snap.session.reason }}</div>
    </div>

    <div ref="feed" class="feed" @scroll="trackScroll">
      <div ref="inner" class="feed-inner">
        <div v-if="!rows.length && !pending.length" class="feed-empty">
          <div class="feed-empty-title">{{ snap.session.status === 'starting' ? 'Подключаемся к агенту…' : 'С чего начнём?' }}</div>
          <div class="feed-empty-text">Опишите задачу. Введите <kbd>@</kbd>, чтобы сослаться на файл проекта, или <kbd>/</kbd> для команд агента.</div>
        </div>

        <template v-for="row in rows" :key="row.seq">
          <div v-if="row.type === 'user'" class="msg-user">
            <div class="bubble">
              <div v-if="row.payload.text" class="bubble-text"><template v-for="(part, i) in withMentions(row.payload.text)" :key="i"><span v-if="part.mention" class="mention">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></div>
              <div v-if="extras(row).length" class="bubble-extras">
                <span v-for="(extra, i) in extras(row)" :key="i" class="extra">{{ extra }}</span>
              </div>
            </div>
          </div>
          <div v-else-if="row.type === 'assistant'" class="msg-agent">
            <MessageMarkdown :text="String(row.payload.text ?? '')" :live="row.live" />
          </div>
          <details v-else-if="row.type === 'thought'" class="thought" :open="row.live">
            <summary>
              <svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5a4 4 0 0 0-2.5 7.1V11h5V9.6A4 4 0 0 0 8 2.5zM6 13.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
              {{ row.live ? 'Размышляет…' : 'Размышления' }}
            </summary>
            <MessageMarkdown class="thought-body" :text="String(row.payload.text ?? '')" :live="row.live" />
          </details>
          <ToolCallCard v-else-if="row.type === 'tool_call'" :call="row.payload" />
          <div v-else-if="row.type === 'plan'" class="card plan">
            <div class="card-label">План</div>
            <div v-for="(entry, index) in row.payload.entries" :key="index" class="plan-entry" :class="entry.status">
              <span class="plan-check" />
              <span>{{ entry.content }}</span>
            </div>
          </div>
          <div v-else-if="row.type === 'add_finding'" class="card finding">
            <span class="finding-severity" :class="row.payload.severity">{{ severityLabel(String(row.payload.severity)) }}</span>
            <code class="finding-loc">{{ row.payload.file }}:{{ row.payload.line }}</code>
            <div class="finding-message">{{ row.payload.message }}</div>
          </div>
          <div v-else-if="row.type === 'submit_review'" class="card verdict" :class="row.payload.verdict">
            {{ row.payload.verdict === 'approved' ? '✓ Ревью одобрено' : '↻ Нужны исправления' }}
          </div>
          <div v-else-if="NOTICES[row.type]" class="card notice" :class="row.type">
            <div class="card-label">{{ NOTICES[row.type] }}</div>
            <div class="notice-text">{{ row.payload.summary ?? row.payload.question ?? row.payload.note ?? row.payload.text ?? '' }}</div>
          </div>
        </template>

        <div v-for="item in pending" :key="item.id" class="msg-user pending">
          <div class="bubble"><div class="bubble-text">{{ item.text || 'Вложение' }}</div></div>
        </div>

        <div v-if="showTyping" class="typing-dots"><span /><span /><span /></div>

        <div v-for="permission in snap.permissions" :key="permission.permissionId" class="card permission">
          <div class="card-label">Нужно разрешение</div>
          <div class="permission-title">{{ permission.toolCall.title }}</div>
          <div class="permission-actions">
            <AppButton
              v-for="option in permission.options"
              :key="option.optionId"
              size="sm"
              :variant="option.kind === 'allow_once' ? 'primary' : option.kind?.startsWith('reject') ? 'danger-ghost' : 'ghost'"
              @click="action('permission', { permissionId: permission.permissionId, optionId: option.optionId })"
            >{{ option.name }}</AppButton>
          </div>
        </div>
      </div>
    </div>

    <div class="dock">
      <div class="dock-inner">
        <div v-if="snap.queue.length" class="queue">
          <div v-for="queued in snap.queue" :key="queued.id" class="queue-item">
            <span class="queue-label">В очереди</span>
            <span class="queue-text">{{ queueText(queued.content) }}</span>
            <AppButton size="xs" variant="subtle" @click="editQueue(queued)">Изменить</AppButton>
            <AppButton size="xs" variant="subtle" @click="removeQueue(queued.id)">Убрать</AppButton>
          </div>
        </div>
        <ChatComposer
          ref="composer"
          :project-id="snap.session.project_id"
          :commands="commands"
          :busy="thinking"
          @send="send"
          @cancel="action('cancel')"
          @error="error = $event"
        >
          <template #status>
            <UsageMeter :agent-id="snap.session.agent_id" :usage="usage" />
          </template>
        </ChatComposer>
        <AgentSettingsBar
          :policy="snap.session.policy"
          :selects="selects"
          :locked="locked"
          :busy="busy"
          @policy="policyChanged"
          @change="changeOption"
        />
        <div v-if="error" class="dock-error">{{ error }} <button type="button" @click="error = ''">×</button></div>
      </div>
    </div>
  </section>
  <div v-else class="empty-state">{{ error || 'Загрузка чата…' }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { api } from '@core/api'
import { useAgentsStore } from '@features/agents'
import AppButton from '@shared/ui/AppButton.vue'
import ChatComposer, { type ContentBlock } from './ChatComposer.vue'
import MessageMarkdown from './MessageMarkdown.vue'
import ToolCallCard from './ToolCallCard.vue'
import UsageMeter, { type UsageInfo } from './UsageMeter.vue'
import AgentSettingsBar from './AgentSettingsBar.vue'
import { agentSelects, type AgentOptionsSource, type AgentSelect } from '../utils/agent-options'
import { useChatStore, statusLabel, statusTone, type ChatEvent, type ChatSession } from '../stores/sessions'

const props = defineProps<{ sessionId: string; initialContent?: ContentBlock[] }>()
const emit = defineEmits<{ session: [id: string] }>()
const store = useChatStore()
const agents = useAgentsStore()
const snap = computed(() => store.snapshots[props.sessionId])
const error = ref('')
const feed = ref<HTMLElement>(), inner = ref<HTMLElement>(), composer = ref<InstanceType<typeof ChatComposer>>()
const pending = ref<{ id: number; text: string }[]>([])
let follow = true
let pendingId = 0

const NOTICES: Record<string, string> = { notice: 'Сессия перезапущена', complete_step: 'Шаг завершён', request_help: 'Агенту нужна помощь', report_progress: 'Прогресс' }
const severityLabel = (severity: string) => ({ low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критично' }[severity] ?? severity)

const agentName = computed(() => agents.agents.find(a => a.id === snap.value?.session.agent_id)?.name ?? '')
const busy = computed(() => ['thinking', 'starting'].includes(snap.value?.session.status ?? ''))
const thinking = computed(() => snap.value?.session.status === 'thinking')
const commands = computed(() => [...(snap.value?.events ?? [])].reverse().find(e => e.type === 'available_commands_update')?.payload.availableCommands ?? [])
interface SessionMeta extends AgentOptionsSource { usage?: UsageInfo }
const meta = computed(() => (snap.value?.session.metadata ?? {}) as SessionMeta)
// Planning/review steps pin the session read-only until execution starts.
const locked = computed(() => snap.value?.session.policy === 'read-only' && snap.value?.session.role !== 'chat')
const selects = computed(() => agentSelects(meta.value).map(select => {
  // session.model may be an alias the agent reports differently; prefer a value that is actually listed.
  if (select.kind !== 'model') return select
  const listed = [snap.value?.session.model, select.current].find(v => v && select.options.some(o => o.value === v))
  return { ...select, current: listed ?? select.current }
}))

// Context usage is per chat; subscription limits are per agent account (see UsageMeter).
const usage = computed(() => meta.value.usage ?? null)

type Row = ChatEvent & { live?: boolean }
const rows = computed(() => {
  const list: Row[] = []
  for (const event of snap.value?.events ?? []) {
    if (event.type === 'tool_call_update') {
      const tool = list.find(e => e.type === 'tool_call' && e.payload.toolCallId === event.payload.toolCallId)
      if (tool) tool.payload = { ...tool.payload, ...event.payload }
    } else if (event.type === 'plan') {
      const old = list.findIndex(e => e.type === 'plan'); if (old >= 0) list.splice(old, 1)
      list.push(event)
    } else list.push({ ...event, payload: { ...event.payload } })
  }
  // The in-flight chunk becomes a row keyed by the seq its final event will get, so the same
  // component instance keeps typing when the message is committed — no jump at the end.
  const streaming = snap.value?.streaming
  if (streaming?.text) {
    const seq = (snap.value!.events[snap.value!.events.length - 1]?.seq ?? 0) + 1
    list.push({ seq, session_id: props.sessionId, type: streaming.type === 'thought' ? 'thought' : 'assistant', payload: { text: streaming.text }, live: true })
  }
  return list
})
const showTyping = computed(() => (busy.value || pending.value.length > 0) && !rows.value[rows.value.length - 1]?.live && !snap.value?.permissions.length)

function withMentions(text: string) {
  return text.split(/((?:^|(?<=\s))@\S+)/).filter(Boolean).map(part => ({ text: part, mention: part.startsWith('@') }))
}
function extras(row: Row) {
  const content = (row.payload as { content?: { type: string; name?: string; resource?: { uri?: string } }[] }).content ?? []
  return content.flatMap(c => c.type === 'image' ? ['🖼 изображение'] : c.type === 'resource' ? ['📎 ' + decodeURIComponent(c.resource?.uri?.split('/').pop() ?? 'файл')] : [])
}

// ── Scrolling: stick to the bottom while the user hasn't scrolled up ───────
function scrollDown() { if (follow && feed.value) feed.value.scrollTop = feed.value.scrollHeight }
function trackScroll() { const el = feed.value!; follow = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
const observer = new ResizeObserver(scrollDown)
watch(inner, (el, old) => { if (old) observer.unobserve(old); if (el) observer.observe(el) })
onBeforeUnmount(() => observer.disconnect())

watch(() => props.sessionId, async id => {
  error.value = ''
  pending.value = []
  follow = true
  await store.connect()
  try { await store.load(id) } catch (e) { error.value = String(e); return }
  await nextTick()
  scrollDown()
  if (props.initialContent?.length) void send(props.initialContent)
  else composer.value?.focus()
}, { immediate: true })

// A finished (or failed) turn is when limits actually move, so refresh them right away.
watch(thinking, (now, before) => { if (before && !now && snap.value) void store.fetchLimits(snap.value.session.agent_id, true) })

// The real user event usually arrives over the socket before the POST resolves.
watch(() => snap.value?.events.length ?? 0, (count, before) => {
  if (pending.value.length && count > before && snap.value!.events.slice(before).some(e => e.type === 'user')) pending.value.shift()
})

async function action(name: string, body: unknown = {}) {
  try { error.value = ''; await api.post(`/agent-sessions/${props.sessionId}/${name}`, body); await store.load(props.sessionId) }
  catch (e) { error.value = String(e) }
}
async function send(content: ContentBlock[]) {
  const item = { id: ++pendingId, text: content.filter(c => c.type === 'text').map(c => String(c.text)).join('\n') }
  follow = true
  if (!thinking.value) pending.value.push(item) // a prompt sent mid-turn shows up in the queue instead
  try { error.value = ''; await api.post(`/agent-sessions/${props.sessionId}/prompt`, { content }); await store.load(props.sessionId) }
  catch (e) { error.value = String(e); if (item.text) void composer.value?.setText(item.text) }
  finally { pending.value = pending.value.filter(p => p.id !== item.id) }
}
async function policyChanged(policy: string) {
  try { store.put(await api.patch<ChatSession>(`/agent-sessions/${props.sessionId}`, { policy })) } catch (e) { error.value = String(e) }
}
function changeOption(select: AgentSelect, value: string) {
  if (select.kind === 'model') void action('model', { model: value })
  else if (select.kind === 'mode') void action('mode', { mode: value })
  else void action('config', { configId: select.configId, value })
}
function queueText(content: string) { try { return (JSON.parse(content) as { text?: string }[]).map(c => c.text ?? '[вложение]').join(' ') } catch { return content } }
async function removeQueue(id: string) { await api.delete(`/agent-sessions/${props.sessionId}/queue/${id}`); await store.load(props.sessionId) }
async function editQueue(item: { id: string; content: string }) { void composer.value?.setText(queueText(item.content)); await removeQueue(item.id) }
async function newContext() {
  try { const session = await api.post<ChatSession>(`/agent-sessions/${props.sessionId}/context`); emit('session', session.id) }
  catch (e) { error.value = String(e) }
}
</script>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }

.chat-head { display: flex; align-items: center; gap: var(--sp-3); height: 48px; padding: 0 var(--sp-4); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.chat-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--sp-2); }
.chat-title strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agent { font-size: 12px; color: var(--text-faint); white-space: nowrap; }

.banner { display: flex; align-items: center; gap: var(--sp-2); padding: 10px var(--sp-4); font-size: 13px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.banner-text { flex: 1; min-width: 0; overflow-wrap: anywhere; max-height: 90px; overflow-y: auto; }
.banner-hint { display: block; font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.banner-error { background: var(--danger-soft); color: var(--danger-hover); }
.banner-wait { background: var(--warning-soft); color: var(--warning-text); }

.feed { flex: 1; min-height: 0; overflow-y: auto; }
.feed-inner { max-width: 820px; margin: 0 auto; padding: var(--sp-6) var(--sp-5) var(--sp-4); display: flex; flex-direction: column; gap: 14px; }

.feed-empty { margin: 12vh auto 0; max-width: 420px; text-align: center; }
.feed-empty-title { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
.feed-empty-text { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
kbd { font-family: inherit; font-size: 11px; padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg3); }

.msg-user { display: flex; justify-content: flex-end; }
.bubble { max-width: 82%; padding: 9px 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 14px 14px 4px 14px; }
.bubble-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.55; }
.bubble-extras { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.extra { font-size: 11.5px; color: var(--text-muted); padding: 1px 7px; border-radius: var(--radius-pill); background: var(--bg2); border: 1px solid var(--border); }
.mention { color: var(--blue-hover); background: var(--blue-soft); border-radius: 4px; padding: 0 3px; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; }
.pending .bubble { opacity: 0.6; }

.msg-agent { padding: 0 2px; }

.thought { color: var(--text-muted); }
.thought summary { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; list-style: none; user-select: none; padding: 2px 0; }
.thought summary::-webkit-details-marker { display: none; }
.thought summary:hover { color: var(--text); }
.thought summary svg { width: 14px; height: 14px; }
.thought-body { margin-top: 6px; padding-left: 12px; border-left: 2px solid var(--border); font-size: 13px; color: var(--text-muted); }

.card { padding: 12px 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); }
.card-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 8px; }

.plan-entry { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; padding: 2px 0; }
.plan-check { width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: 4px; }
.plan-entry.in_progress .plan-check { border-color: var(--blue-hover); background: var(--blue-soft); }
.plan-entry.completed { color: var(--text-muted); text-decoration: line-through; }
.plan-entry.completed .plan-check { border-color: var(--accent); background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5 5.5-6' stroke='white' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat; }

.notice-text { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.notice.request_help { border-color: var(--warning-soft); background: var(--warning-soft); }
.notice.complete_step { border-color: var(--accent-soft); }

.permission { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.permission-title { font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; margin-bottom: 10px; overflow-wrap: anywhere; }
.permission-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.typing-dots { display: flex; gap: 4px; padding: 6px 2px; }
.typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); animation: bounce 1.2s infinite ease-in-out; }
.typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.typing-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce { 0%, 60%, 100% { opacity: 0.35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

.dock { flex-shrink: 0; padding: 0 var(--sp-5) var(--sp-4); }
.dock-inner { max-width: 820px; margin: 0 auto; }
.dock-error { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--danger-hover); }
.dock-error button { background: none; border: none; color: inherit; cursor: pointer; font-size: 14px; }

.queue { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.queue-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 10px; font-size: 12.5px; background: var(--bg2); border: 1px dashed var(--border-strong); border-radius: var(--radius); }
.queue-label { font-size: 11px; font-weight: 600; color: var(--warning-text); white-space: nowrap; }
.queue-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }

.finding { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; border-left: 3px solid var(--border-strong); }
.finding-severity { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 8px; border: 1px solid var(--border); color: var(--text-muted); white-space: nowrap; }
.finding-severity.low { border-color: var(--text-muted); }
.finding-severity.medium { border-color: var(--warning); color: var(--warning); }
.finding-severity.high { border-color: var(--danger-hover); color: var(--danger-hover); }
.finding-severity.critical { border-color: var(--danger); color: #fff; background: var(--danger); }
.finding-loc { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted); }
.finding-message { flex-basis: 100%; font-size: 13px; }
.verdict { font-weight: 600; text-align: center; }
.verdict.approved { color: var(--accent-hover); }
.verdict.changes_requested { color: var(--warning); }
</style>
