<template>
  <section class="cp" :class="{ compact: !expanded }">
    <header class="cp-head">
      <span class="cp-title">Чаты с агентом</span>
      <nav class="cp-tabs" aria-label="Чаты доработки">
        <button
          v-for="entry in chatTabs" :key="entry.session.id" type="button" class="cp-tab" :class="{ active: !sending && selected === entry.session.id }"
          :title="entry.session.title" @click="select(entry.session.id)"
        ><span class="cp-dot" :class="entry.session.status" />{{ entry.session.title }}<span v-if="entry.pending" class="cp-pending" :title="`Не закрыто пунктов: ${entry.pending}`">{{ entry.pending }}</span></button>
      </nav>
      <AppButton v-if="expanded && !sending && drafts" variant="subtle" size="xs" title="Отправить черновики агенту" @click="beginSend()">+ Новый</AppButton>
      <AppButton v-if="!sending && selected" variant="danger-ghost" size="xs" icon title="Удалить чат: замечания останутся" @click="remove"><IconTrash /></AppButton>
    </header>

    <div v-if="!expanded" class="cp-hint">Чатов с агентом пока нет. «Отправить» в списке замечаний создаст чат или добавит раунд в существующий.</div>

    <div v-else class="cp-body">
      <div v-if="sending" class="cp-send">
        <div class="cp-send-head">
          <span>Отправить {{ drafts }} {{ drafts % 10 === 1 && drafts % 100 !== 11 ? 'пункт' : 'пунктов' }} агенту доработки</span>
          <button type="button" class="cp-link" @click="sending = false">Отмена</button>
        </div>
        <div v-if="busyAgent" class="cp-error">Агент отвечает: отправка новых замечаний недоступна, пока он не закончит.</div>
        <div v-if="chatTabs.length" class="cp-targets" role="radiogroup" aria-label="Куда отправить">
          <label v-for="entry in chatTabs" :key="entry.session.id" class="cp-target" :class="{ on: target === entry.session.id }">
            <input v-model="target" type="radio" :value="entry.session.id" /> В чат «{{ entry.session.title }}»<span v-if="entry.round" class="cp-muted"> · был раунд {{ entry.round }}</span>
          </label>
          <label class="cp-target" :class="{ on: target === '' }"><input v-model="target" type="radio" value="" /> Новый чат</label>
        </div>
        <div v-if="target" class="cp-existing">
          <textarea v-model="note" class="cp-note" rows="3" placeholder="Комментарий к раунду (необязательно)" />
          <AppButton variant="blue" size="sm" :disabled="busy || busyAgent" @click="sendExisting">{{ busy ? 'Отправка…' : 'Отправить в чат' }}</AppButton>
        </div>
        <div v-if="error" class="cp-error">{{ error }}</div>
        <NewChatPanel
          v-if="!target"
          :project-id="projectId" :default-agent-id="defaultAgentId" title="Доработка по замечаниям"
          text="Агент получит список замечаний, исправит бесспорные, ответит на вопросы и спросит про сомнительные. Он видит код и меняет файлы проекта, git-команды ему запрещены."
          placeholder="Комментарий к раунду (необязательно)" initial-text="Выполни замечания ревью." :busy="busy || busyAgent" @start="startNew"
        />
      </div>
      <ChatView
        v-else-if="selected" ref="chat" :key="selected" :session-id="selected" :cards="['resolve_review_item']" @session="selected = $event"
      >
        <template #card="{ event }">
          <ItemView
            v-if="itemFor(event.payload)" :item="itemFor(event.payload)!" show-location :agent-working="busyAgent"
            @goto="emit('goto', itemFor(event.payload)!)" @open-ref="emit('open-ref', $event)" @discuss="discuss(itemFor(event.payload)!)"
          />
          <div v-else class="cp-gone">Пункт ревью удалён: {{ String((event.payload as { answer?: unknown }).answer ?? '') }}</div>
        </template>
      </ChatView>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { ChatView, NewChatPanel, useChatStore, type ChatSession, type NewChatRequest } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { useCodeStore } from '../stores/code'
import type { CodeReviewItem } from '../types'
import ItemView from './ItemView.vue'

const props = defineProps<{ projectId: string; defaultAgentId?: string | null; agentWorking?: boolean }>()
const emit = defineEmits<{ goto: [item: CodeReviewItem]; 'open-ref': [ref: string] }>()
const chats = useChatStore()
const store = useCodeStore()
const app = useAppStore()
const selected = ref('')
const sending = ref(false)
const target = ref('')
const note = ref('')
const busy = ref(false)
const error = ref('')
const chat = ref<InstanceType<typeof ChatView> | null>(null)

const drafts = computed(() => store.items.filter(i => i.status === 'draft').length)
/** Chats of this review, in the order of their first round; a chat can serve several rounds. */
const chatTabs = computed(() => {
  const result: { session: ChatSession; pending: number; round: number }[] = []
  for (const round of store.rounds) {
    if (!round.session_id || result.some(c => c.session.id === round.session_id)) continue
    const session = chats.sessions.find(s => s.id === round.session_id && s.role === 'code-fixer')
    if (!session) continue
    const ids = new Set(store.rounds.filter(r => r.session_id === session.id).map(r => r.id))
    const mine = store.items.filter(i => i.round_id && ids.has(i.round_id))
    result.push({ session, round: Math.max(...store.rounds.filter(r => r.session_id === session.id).map(r => r.n)),
      pending: mine.filter(i => i.status === 'sent' || i.status === 'needs_decision').length })
  }
  return result
})
const expanded = computed(() => chatTabs.value.length > 0 || sending.value)
const busyAgent = computed(() => props.agentWorking || chatTabs.value.some(c => ['starting', 'thinking', 'waiting'].includes(c.session.status)))

// The chat of the latest round opens by default; losing the chosen one (deleted) falls back to it.
watch(chatTabs, tabs => {
  if (!selected.value || !tabs.some(c => c.session.id === selected.value)) selected.value = tabs[tabs.length - 1]?.session.id ?? ''
}, { immediate: true })
watch(() => props.projectId, () => { void chats.connect() }, { immediate: true })

function select(id: string) { sending.value = false; selected.value = id }

/** Starts the «send round» flow: the last chat is the default target when it exists. */
function beginSend() {
  if (!drafts.value) return
  error.value = ''; note.value = ''
  target.value = chatTabs.value[chatTabs.value.length - 1]?.session.id ?? ''
  sending.value = true
}

async function finishSend(sessionId: string) {
  sending.value = false
  selected.value = sessionId
  note.value = ''
}
async function sendExisting() {
  busy.value = true; error.value = ''
  try {
    const review = store.review
    if (!review) throw new Error('Нет открытого ревью')
    await store.sendRound(review.id, target.value, note.value)
    await finishSend(target.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function startNew({ content, ...options }: NewChatRequest) {
  busy.value = true; error.value = ''
  let created: ChatSession | null = null
  try {
    const review = store.review
    if (!review) throw new Error('Нет открытого ревью')
    created = await api.post<ChatSession>('/agent-sessions', { project_id: props.projectId, role: 'code-fixer', ...options })
    chats.put(created)
    const text = content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim()
    // "Выполни замечания ревью." is only the composer's default; the round message is generated by the server.
    await store.sendRound(review.id, created.id, text === 'Выполни замечания ревью.' ? '' : text)
    await finishSend(created.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    // A chat that never got a round would be an orphan nobody can find.
    if (created) await chats.remove(created.id).catch(() => undefined)
  } finally { busy.value = false }
}

async function remove() {
  const current = chatTabs.value.find(c => c.session.id === selected.value)
  if (!current || !(await app.confirm(`Удалить чат «${current.session.title}»? Замечания и их статусы останутся.`))) return
  try { await chats.remove(current.session.id); await store.refresh() }
  catch (cause) { app.toast(String(cause), 'error') }
}

const itemFor = (payload: object): CodeReviewItem | undefined => {
  const { item_id, id } = payload as { item_id?: unknown; id?: unknown }
  return store.items.find(i => i.id === String(item_id ?? id ?? ''))
}

/** Opens the chat that handled the item and starts a message about it. */
async function discuss(item: CodeReviewItem) {
  const round = store.rounds.find(r => r.id === item.round_id)
  if (round?.session_id) await openChat(round.session_id, `По пункту «${item.text.replace(/\s+/g, ' ').slice(0, 80)}»: `)
}
async function openChat(sessionId: string, text?: string) {
  sending.value = false
  selected.value = sessionId
  if (text) { await nextTick(); await nextTick(); chat.value?.setText(text) }
}
defineExpose({ beginSend, openChat })
</script>

<style scoped>
.cp { display: flex; flex-direction: column; min-height: 0; flex: 1 1 0; border-top: 1px solid var(--border); }
.cp.compact { flex: none; }
.cp-head { display: flex; align-items: center; gap: 6px; flex-shrink: 0; height: 36px; padding: 0 12px; }
.cp-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); white-space: nowrap; }
.cp-tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; align-self: stretch; }
.cp-tab { flex-shrink: 0; max-width: 160px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; margin-bottom: -1px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-tab:hover { color: var(--text); }
.cp-tab.active { color: var(--text); border-bottom-color: var(--blue); }
.cp-pending { min-width: 16px; padding: 0 5px; font-size: 10px; font-weight: 600; text-align: center; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); }
.cp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--border-strong); }
.cp-dot.thinking, .cp-dot.starting { background: var(--blue-hover); animation: cp-pulse 1.4s ease-in-out infinite; }
.cp-dot.waiting { background: var(--warning-text); }
.cp-dot.complete, .cp-dot.ready { background: var(--accent-hover); }
.cp-dot.error { background: var(--danger-hover); }
@keyframes cp-pulse { 50% { opacity: 0.35; } }
.cp-hint { padding: 0 12px 12px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.cp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.cp-send { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
.cp-send-head { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
.cp-link { padding: 0; font: inherit; font-size: 12px; font-weight: 400; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.cp-targets { display: flex; flex-direction: column; gap: 4px; }
.cp-target { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.cp-target.on { border-color: var(--blue); background: var(--blue-soft); }
.cp-muted { color: var(--text-muted); }
.cp-existing { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.cp-note { width: 100%; box-sizing: border-box; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); resize: vertical; }
.cp-error { font-size: 12px; color: var(--danger-hover); }
.cp-gone { font-size: 12px; color: var(--text-muted); }
</style>
