<template>
  <section class="chat" v-if="snap">
    <header>
      <strong>{{ snap.session.title }}</strong><span :class="snap.session.status">{{ statusLabel(snap.session.status) }}</span>
      <button v-if="['thinking', 'waiting'].includes(snap.session.status)" class="btn btn-ghost" @click="action('cancel')">■ Стоп</button>
    </header>
    <div v-if="snap.session.reason" class="reason" :class="snap.session.status">{{ snap.session.reason }}</div>
    <div v-if="snap.session.status === 'error'" class="recovery">
      <button class="btn" @click="action('retry')">Повторить</button>
      <button class="btn" @click="newContext">Новый чат с контекстом</button>
      <span>Если требуется вход, выполните команду входа CLI во вкладке «Терминал».</span>
    </div>
    <div ref="feed" class="feed" @scroll="trackScroll">
      <template v-for="event in displayEvents" :key="event.seq">
        <article v-if="['user', 'assistant'].includes(event.type)" :class="event.type">
          <small>{{ event.type === 'user' ? 'Вы' : 'Агент' }}</small>
          <div class="markdown" v-html="render(String(event.payload.text ?? ''))" />
        </article>
        <details v-else-if="event.type === 'thought'"><summary>Размышления</summary><div v-html="render(String(event.payload.text ?? ''))" /></details>
        <details v-else-if="event.type === 'tool_call'">
          <summary>{{ event.payload.title }} · {{ event.payload.status }}</summary>
          <template v-for="(part, index) in event.payload.content" :key="index">
            <div v-if="part.type === 'diff'" class="diff"><strong>{{ part.path }}</strong><pre class="removed">{{ part.oldText }}</pre><pre class="added">{{ part.newText }}</pre></div>
            <pre v-else>{{ part.content?.text ?? JSON.stringify(part, null, 2) }}</pre>
          </template>
          <pre v-if="event.payload.rawOutput">{{ typeof event.payload.rawOutput === 'string' ? event.payload.rawOutput : JSON.stringify(event.payload.rawOutput, null, 2) }}</pre>
        </details>
        <div v-else-if="event.type === 'plan'" class="plan"><div v-for="(entry, index) in event.payload.entries" :key="index">{{ entry.status === 'completed' ? '☑' : '☐' }} {{ entry.content }}</div></div>
        <article v-else-if="event.type === 'add_finding'" class="finding">
          <span class="finding-severity" :class="event.payload.severity">{{ severityLabel(String(event.payload.severity)) }}</span>
          <code class="finding-loc">{{ event.payload.file }}:{{ event.payload.line }}</code>
          <div class="finding-message">{{ event.payload.message }}</div>
        </article>
        <article v-else-if="event.type === 'submit_review'" class="verdict" :class="event.payload.verdict">
          {{ event.payload.verdict === 'approved' ? '✓ Ревью одобрено' : '↻ Нужны исправления' }}
        </article>
        <article v-else-if="['request_help', 'report_progress', 'complete_step'].includes(event.type)"><strong>{{ event.type }}</strong><pre>{{ event.payload }}</pre></article>
      </template>
      <article v-if="snap.streaming?.text"><small>{{ snap.streaming.type === 'thought' ? 'Размышления' : 'Агент' }}</small><div v-html="render(snap.streaming.text)" /></article>
    </div>
    <div v-for="permission in snap.permissions" :key="permission.permissionId" class="permission">
      <p>{{ permission.toolCall.title }}</p>
      <button v-for="option in permission.options" :key="option.optionId" class="btn" @click="action('permission', { permissionId: permission.permissionId, optionId: option.optionId })">{{ option.name }}</button>
    </div>
    <div v-for="queued in snap.queue" :key="queued.id" class="queued">
      <span>В очереди: {{ queueText(queued.content) }}</span>
      <button class="btn" @click="editQueue(queued)">Изменить</button><button class="btn" @click="removeQueue(queued.id)">Удалить</button>
    </div>
    <form @submit.prevent="send" @dragover.prevent @drop.prevent="drop">
      <div v-if="attachments.length">Вложения: {{ attachments.length }} <button type="button" class="btn" @click="attachments = []">Убрать</button></div>
      <textarea v-model="text" placeholder="Сообщение…" rows="3" @keydown.enter.exact.prevent="send" @input="resize" @paste="paste" />
      <div class="composer-actions">
        <label class="btn">📎<input type="file" multiple hidden @change="filesSelected" /></label>
        <select :value="snap.session.policy" :disabled="snap.session.policy === 'read-only' && snap.session.role !== 'chat'" @change="policyChanged">
          <option value="ask">Спрашивать</option><option value="allow-edits">Разрешать правки</option><option value="allow-all">Без вопросов</option><option value="read-only">Только чтение</option>
        </select>
        <select v-if="models.length" :value="snap.session.model" @change="modelChanged"><option value="" disabled>Модель</option><option v-for="model in models" :key="model.value" :value="model.value">{{ model.name }}</option></select>
        <button class="btn btn-primary" :disabled="sending || (!text.trim() && !attachments.length)">{{ snap.session.status === 'thinking' ? 'В очередь' : 'Отправить' }}</button>
      </div>
      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="text.startsWith('/')" class="commands"><button v-for="command in commands" :key="command.name" type="button" class="btn" @click="text = '/' + command.name + ' '">/{{ command.name }} — {{ command.description }}</button></div>
    </form>
  </section>
  <div v-else class="empty-state">{{ error || 'Загрузка чата…' }}</div>
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { api } from '@core/api'
import { useChatStore, statusLabel, type ChatEvent, type ChatSession } from '../stores/sessions'
const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ session: [id: string] }>()
const store = useChatStore()
const snap = computed(() => store.snapshots[props.sessionId])
const text = ref(''), error = ref(''), sending = ref(false), feed = ref<HTMLElement>()
const attachments = ref<Record<string, unknown>[]>([])
let follow = true
const md = new MarkdownIt({ html: false, linkify: true, highlight: (code, lang) => lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : '' })
const render = (value: string) => md.render(value)
const severityLabel = (severity: string) => ({ low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критично' }[severity] ?? severity)
const commands = computed(() => [...(snap.value?.events ?? [])].reverse().find(e => e.type === 'available_commands_update')?.payload.availableCommands ?? [])
const models = computed(() => {
  const metadata = snap.value?.session.metadata as { configOptions?: { category: string; options: { value: string; name: string; options?: { value: string; name: string }[] }[] }[]; models?: { availableModels: { modelId: string; name: string }[] } } | undefined
  const options = metadata?.configOptions?.find(o => o.category === 'model')?.options
  return options?.flatMap(o => o.options ?? [o]) ?? metadata?.models?.availableModels?.map(m => ({ value: m.modelId, name: m.name })) ?? []
})
const displayEvents = computed(() => {
  const rows: ChatEvent[] = []
  for (const event of snap.value?.events ?? []) {
    if (event.type === 'tool_call_update') {
      const tool = rows.find(e => e.type === 'tool_call' && e.payload.toolCallId === event.payload.toolCallId)
      if (tool) tool.payload = { ...tool.payload, ...event.payload }
    } else if (event.type === 'plan') {
      const old = rows.findIndex(e => e.type === 'plan'); if (old >= 0) rows.splice(old, 1)
      rows.push(event)
    } else rows.push({ ...event, payload: { ...event.payload } })
  }
  return rows
})
watch(() => props.sessionId, async id => { text.value = ''; error.value = ''; await store.connect(); try { await store.load(id) } catch (e) { error.value = String(e) } }, { immediate: true })
watch(() => [snap.value?.events.length, snap.value?.streaming?.text], async () => { await nextTick(); if (follow && feed.value) feed.value.scrollTop = feed.value.scrollHeight })
function trackScroll() { const el = feed.value!; follow = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }
function resize(event: Event) { const el = event.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px' }
async function action(name: string, body: unknown = {}) { try { error.value = ''; await api.post(`/agent-sessions/${props.sessionId}/${name}`, body); await store.load(props.sessionId) } catch (e) { error.value = String(e) } }
async function send() {
  if (sending.value || (!text.value.trim() && !attachments.value.length)) return
  sending.value = true
  try { await api.post(`/agent-sessions/${props.sessionId}/prompt`, { content: [...(text.value.trim() ? [{ type: 'text', text: text.value }] : []), ...attachments.value] }); text.value = ''; attachments.value = []; await store.load(props.sessionId) }
  catch (e) { error.value = String(e) } finally { sending.value = false }
}
async function policyChanged(event: Event) { try { store.put(await api.patch<ChatSession>(`/agent-sessions/${props.sessionId}`, { policy: (event.target as HTMLSelectElement).value })) } catch (e) { error.value = String(e) } }
function modelChanged(event: Event) { void action('model', { model: (event.target as HTMLSelectElement).value }) }
function queueText(content: string) { try { return (JSON.parse(content) as { text?: string }[]).map(c => c.text ?? '[вложение]').join(' ') } catch { return content } }
async function removeQueue(id: string) { await api.delete(`/agent-sessions/${props.sessionId}/queue/${id}`); await store.load(props.sessionId) }
async function editQueue(item: { id: string; content: string }) { text.value = queueText(item.content); await removeQueue(item.id) }
async function newContext() { try { const session = await api.post<ChatSession>(`/agent-sessions/${props.sessionId}/context`); emit('session', session.id) } catch (e) { error.value = String(e) } }
async function addFiles(files: File[]) {
  for (const file of files) {
    if (file.size > 10_000_000) { error.value = 'Файл больше 10 МБ'; continue }
    if (file.type.startsWith('image/')) {
      const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
      attachments.value.push({ type: 'image', mimeType: file.type, data })
    } else attachments.value.push({ type: 'resource', resource: { uri: `file:///${encodeURIComponent(file.name)}`, mimeType: file.type || 'text/plain', text: await file.text() } })
  }
}
function filesSelected(event: Event) { void addFiles(Array.from((event.target as HTMLInputElement).files ?? [])) }
function drop(event: DragEvent) { void addFiles(Array.from(event.dataTransfer?.files ?? [])) }
function paste(event: ClipboardEvent) { if (event.clipboardData?.files.length) { event.preventDefault(); void addFiles(Array.from(event.clipboardData.files)) } }
</script>
<style scoped>
.chat{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg)}header,.composer-actions{display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border)}header strong{flex:1}.feed{flex:1;overflow:auto;padding:16px;min-height:100px}article,details,.plan{margin-bottom:14px;padding:10px;border-radius:6px;background:var(--bg2)}small{color:var(--text-muted)}.user{margin-left:12%;border:1px solid var(--border)}pre{white-space:pre-wrap;overflow-wrap:anywhere}.reason,.permission,.queued,.recovery{padding:10px;background:var(--bg2)}.waiting,.error{color:var(--danger-hover)}.permission{border:1px solid var(--blue)}.queued{display:flex;gap:8px}.queued span{flex:1}form{padding:10px;border-top:1px solid var(--border)}textarea{width:100%;resize:none;min-height:60px;max-height:220px;background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:10px}.composer-actions{padding:6px 0;border:0;flex-wrap:wrap}select{max-width:220px;background:var(--bg2);color:var(--text);padding:6px;border:1px solid var(--border)}.removed{background:#88222233}.added{background:#22884433}:deep(pre){overflow:auto;padding:10px}:deep(p){margin:6px 0}:deep(a){color:var(--blue)}.commands{display:flex;flex-wrap:wrap}
.finding{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-left:3px solid var(--border-strong)}.finding-severity{font-size:10px;font-weight:600;padding:1px 7px;border-radius:8px;border:1px solid var(--border);color:var(--text-muted);white-space:nowrap}.finding-severity.low{border-color:var(--text-muted)}.finding-severity.medium{border-color:#d29922;color:#d29922}.finding-severity.high{border-color:var(--danger-hover);color:var(--danger-hover)}.finding-severity.critical{border-color:var(--danger);color:#fff;background:var(--danger)}.finding-loc{font-family:'Cascadia Code','JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)}.finding-message{flex-basis:100%;font-size:13px}.verdict{font-weight:600;text-align:center}.verdict.approved{color:var(--accent)}.verdict.changes_requested{color:#d29922}
</style>
