<template>
  <section class="cp">
    <!-- One chat needs no switcher: the chat's own header names it. -->
    <header v-if="tabs.length > 1 || newChat" class="cp-head">
      <nav class="cp-tabs" aria-label="Чаты доработки">
        <button
          v-for="entry in tabs" :key="entry.session.id" type="button" class="cp-tab" :class="{ active: !newChat && selected === entry.session.id }"
          :title="entry.session.title" @click="select(entry.session.id)"
        ><span class="cp-dot" :class="entry.session.status" />{{ entry.session.title }}<span v-if="entry.pending" class="cp-pending" :title="`Не закрыто пунктов: ${entry.pending}`">{{ entry.pending }}</span></button>
        <span v-if="newChat" class="cp-tab active"><span class="cp-dot" />Новый чат</span>
      </nav>
      <AppButton v-if="newChat && tabs.length" variant="ghost" size="xs" @click="newChat = null">Отмена</AppButton>
    </header>

    <NewChatPanel
      v-if="newChat"
      :project-id="projectId" :default-agent-id="defaultAgentId" title="Новый чат доработки"
      :text="`Уйдёт ${newChatCount} ${plural(newChatCount)}. Агент исправит бесспорное, ответит на вопросы и спросит про сомнительное; git ему запрещён.`"
      placeholder="Комментарий к раунду (необязательно)" :initial-text="DEFAULT_NOTE" :busy="busy || busyAgent" :error="error" @start="startNew"
    />
    <ChatView v-else-if="selected" ref="chat" :key="selected" :session-id="selected" :cards="['resolve_review_item']" @session="selected = $event">
      <template #actions>
        <AppButton variant="danger-ghost" size="xs" icon title="Удалить чат: замечания останутся" @click="remove"><IconTrash /></AppButton>
      </template>
      <template #card="{ event }">
        <ItemView
          v-if="itemFor(event.payload)" :item="itemFor(event.payload)!" show-location :agent-working="busyAgent"
          @goto="emit('goto', itemFor(event.payload)!)" @open-ref="emit('open-ref', $event)" @discuss="discuss(itemFor(event.payload)!)"
          @implement="send([itemFor(event.payload)!.id], selected)"
        />
        <div v-else class="cp-gone">Пункт ревью удалён: {{ String((event.payload as { answer?: unknown }).answer ?? '') }}</div>
      </template>
    </ChatView>
    <div v-else class="cp-empty">
      <div class="cp-empty-title">Чатов с агентом пока нет</div>
      Напишите замечания и нажмите «Отправить» на вкладке «Замечания»: откроется новый чат доработки. Следующие раунды по умолчанию уходят в тот же чат, ▾ рядом с кнопкой — выбрать другой или новый.
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
import { BUSY_STATUSES, useReviewChats, type ReviewChat } from '../composables/review-chats'
import type { CodeReviewItem } from '../types'
import ItemView from './ItemView.vue'

const props = defineProps<{ projectId: string; defaultAgentId?: string | null; agentWorking?: boolean }>()
const emit = defineEmits<{ goto: [item: CodeReviewItem]; 'open-ref': [ref: string] }>()
const chats = useChatStore()
const store = useCodeStore()
const app = useAppStore()
const review = useReviewChats()
const selected = ref('')
/** A new chat being set up (agent, model) for these items; null ids means all drafts. */
const newChat = ref<{ ids: string[] | null } | null>(null)
const busy = ref(false)
const error = ref('')
const chat = ref<InstanceType<typeof ChatView> | null>(null)
/** The new chat whose first round is being delivered (the agent is still connecting). */
const startingChat = ref('')

const DEFAULT_NOTE = 'Выполни замечания ревью.'
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'пункт' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'пункта' : 'пунктов')
const newChatCount = computed(() => newChat.value?.ids?.length ?? store.items.filter(i => i.status === 'draft').length)
const tabs = computed<ReviewChat[]>(() => {
  const result = [...review.list.value]
  // A chat being started for a round has no round yet; it is shown so its «Подключается» status is visible.
  const starting = chats.sessions.find(s => s.id === startingChat.value)
  if (starting && !result.some(c => c.session.id === starting.id)) result.push({ session: starting, round: 0, pending: 0 })
  return result
})
const busyAgent = computed(() => props.agentWorking || tabs.value.some(c => BUSY_STATUSES.includes(c.session.status)))
/** Status of the chat shown in the tab label of the right panel. */
const status = computed(() => tabs.value.find(c => c.session.id === selected.value)?.session.status ?? '')

// The chat of the latest round opens by default; losing the chosen one (deleted) falls back to it.
watch(tabs, list => {
  if (!selected.value || !list.some(c => c.session.id === selected.value)) selected.value = review.latest.value?.session.id ?? list[list.length - 1]?.session.id ?? ''
}, { immediate: true })
watch(() => props.projectId, () => { void chats.connect() }, { immediate: true })

function select(id: string) { newChat.value = null; selected.value = id }

/** Sends items (null: all drafts) to a chat; '' asks for a new chat first. */
async function send(ids: string[] | null, target: string) {
  error.value = ''
  if (!target) { newChat.value = { ids }; return }
  const current = store.review
  if (!current) return
  newChat.value = null
  selected.value = target
  try { await store.sendRound(current.id, target, '', ids ?? undefined) }
  catch (cause) { app.toast(cause instanceof Error ? cause.message : String(cause), 'error') }
}

async function startNew({ content, ...options }: NewChatRequest) {
  const ids = newChat.value?.ids ?? null
  busy.value = true; error.value = ''
  let created: ChatSession | null = null
  try {
    const current = store.review
    if (!current) throw new Error('Нет открытого ревью')
    created = await api.post<ChatSession>('/agent-sessions', { project_id: props.projectId, role: 'code-fixer', ...options })
    chats.put(created)
    // Show the chat at once: connecting to the agent takes a while and its status says so.
    startingChat.value = created.id
    newChat.value = null
    selected.value = created.id
    const note = content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim()
    // The default text only lets the composer send; the round message is generated by the server.
    await store.sendRound(current.id, created.id, note === DEFAULT_NOTE ? '' : note, ids ?? undefined)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    newChat.value = { ids }
    // A chat that never got a round would be an orphan nobody can find.
    if (created) await chats.remove(created.id).catch(() => undefined)
  } finally { busy.value = false; startingChat.value = '' }
}

async function remove() {
  const current = tabs.value.find(c => c.session.id === selected.value)
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
  const target = review.chatOf(item)
  if (target) await openChat(target.session.id, `По пункту «${item.text.replace(/\s+/g, ' ').slice(0, 80)}»: `)
}
async function openChat(sessionId: string, text?: string) {
  newChat.value = null
  selected.value = sessionId
  if (text) { await nextTick(); await nextTick(); chat.value?.setText(text) }
}
defineExpose({ send, openChat, status })
</script>

<style scoped>
.cp { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.cp-head { display: flex; align-items: center; gap: 6px; flex-shrink: 0; height: 32px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); }
.cp-tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; align-self: stretch; }
.cp-tab { flex-shrink: 0; max-width: 200px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; margin-bottom: -1px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-tab:hover { color: var(--text); }
.cp-tab.active { color: var(--text); border-bottom-color: var(--blue); }
.cp-pending { min-width: 16px; padding: 0 5px; font-size: 10px; font-weight: 600; text-align: center; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); }
.cp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--border-strong); }
.cp-dot.thinking, .cp-dot.starting { background: var(--blue-hover); animation: cp-pulse 1.4s ease-in-out infinite; }
.cp-dot.waiting { background: var(--warning-text); }
.cp-dot.complete, .cp-dot.ready { background: var(--accent-hover); }
.cp-dot.error { background: var(--danger-hover); }
@keyframes cp-pulse { 50% { opacity: 0.35; } }
.cp-empty { padding: 16px 12px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.cp-empty-title { margin-bottom: 4px; font-size: 13px; font-weight: 600; color: var(--text); }
.cp-gone { font-size: 12px; color: var(--text-muted); }
</style>
