<template>
  <div class="work-chat">
    <div v-if="showRounds && rounds.length" class="round-cards">
      <ReviewRoundCard v-for="(r, i) in rounds" :key="r.id" :round="i + 1" :live="isLive(r.status)" :auto="task.auto_review" @open="$emit('open-check')" />
    </div>
    <div v-if="chatOptions.length > 1" class="chat-pick">
      <AppSelect v-model="selected" :options="chatOptions" size="sm" prefix="Чат" />
    </div>
    <div v-if="error" class="chat-note error" role="alert">{{ error }}</div>
    <p v-if="shown && awaitingBrief" class="chat-note">Опишите агенту, что сделать: подробности, файлы через @, скриншоты. Агент начнёт работу после первого сообщения.</p>
    <ChatView v-if="shown" :key="shown" :session-id="shown" :no-composer="closed || reviewOpened" />
    <p v-else-if="task.kind === 'errand' && !closed" class="chat-note">{{ workspace?.status === 'failed' ? 'Рабочее место не подготовлено: ' + workspace.error : 'Готовлю рабочее место и подключаю агента… Чат откроется сам.' }}</p>
    <button v-else-if="!loading && !closed" class="btn btn-ghost btn-sm chat-open" @click="open">Открыть чат задачи</button>
    <span v-else-if="loading" class="chat-note">Подготовка чата…</span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChatView, useChatStore, type ChatSession } from '@features/agent-chat'
import { api } from '@core/api'
import type { Task, Workspace } from '@core/models'
import AppSelect from '@shared/ui/AppSelect.vue'
import ReviewRoundCard from './ReviewRoundCard.vue'

const props = defineProps<{ task: Task; workspace?: Workspace | null; defaultAgentId?: string | null; showRounds?: boolean }>()
defineEmits<{ 'open-check': [] }>()
const chats = useChatStore()
const selected = ref(''), primary = ref(''), error = ref(''), loading = ref(false)
const closed = computed(() => props.task.status === 'done')
const mine = computed(() => chats.sessions.filter(s => s.task_id === props.task.id))
const steps = computed(() => mine.value.filter(s => s.role === 'executor'))
const rounds = computed(() => mine.value.filter(s => s.role === 'task-reviewer').sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')))
const shown = computed(() => selected.value || primary.value)
// The reviewer's own chat is read-only: answers to its remarks go through «Проверка».
const reviewOpened = computed(() => rounds.value.some(r => r.id === selected.value))
const chatOptions = computed(() => [
  { value: '', label: props.task.kind === 'errand' ? 'Поручение' : 'Задача (знает всю задачу)' },
  ...(props.task.kind !== 'errand' ? steps.value.map(s => ({ value: s.id, label: s.title || 'Шаг' })) : []),
  ...rounds.value.map((r, i) => ({ value: r.id, label: '🤖 Ревью, раунд ' + (i + 1) })),
])
/** A new errand: its chat is open, the developer writes the request. */
const awaitingBrief = computed(() => {
  const session = chats.sessions.find(s => s.id === shown.value)
  return session?.role === 'errand' && !!session.metadata.awaiting_brief && !(chats.snapshots[session.id]?.events ?? []).some(e => e.type === 'user')
})
const isLive = (status: string) => ['starting', 'thinking', 'waiting'].includes(status)
const primaryRole = computed(() => props.task.kind === 'errand' ? 'errand' : 'task-chat')
watch(() => mine.value.find(s => s.role === primaryRole.value)?.id, id => {
  if (id) { primary.value = id; error.value = '' }
})
async function open() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const chat = await api.post<ChatSession>('/projects/' + props.task.project_id + '/tasks/' + props.task.id + '/chat', { agent_id: props.defaultAgentId })
    chats.put(chat); primary.value = chat.id
  } catch (cause) { error.value = String(cause) }
  finally { loading.value = false }
}
watch(() => props.task.id, () => {
  selected.value = ''; primary.value = ''; error.value = ''
  const existing = mine.value.find(s => s.role === primaryRole.value)
  if (existing) primary.value = existing.id
  // An errand's chat appears by itself once its folder is ready; a task's chat is created on demand.
  else if (!closed.value && props.task.kind !== 'errand') void open()
}, { immediate: true })
</script>
<style scoped>
.work-chat { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 8px; }
.chat-pick { padding: 8px var(--sp-5) 0; }
.chat-note { margin: 0; padding: 10px var(--sp-5) 0; font-size: 12.5px; color: var(--text-muted); }
.chat-note.error { color: var(--danger-hover); }
.chat-open { align-self: flex-start; margin: 12px var(--sp-5); }
.round-cards { display: flex; flex-direction: column; gap: 6px; }
.work-chat :deep(.chat) { flex: 1; min-height: 0; }
</style>
