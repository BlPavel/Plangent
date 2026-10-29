<template>
  <div class="work-chat">
    <div v-if="showRounds && rounds.length" class="round-cards">
      <ReviewRoundCard v-for="(r, i) in rounds" :key="r.id" :round="i + 1" :live="isLive(r.status)" :auto="task.auto_review" @open="$emit('open-check')" />
    </div>
    <select v-model="selected" aria-label="С кем говорить">
      <option value="">{{ task.kind === 'errand' ? 'Чат поручения' : 'Чат задачи (знает всю задачу)' }}</option>
      <template v-if="task.kind !== 'errand'">
        <option v-for="s in steps" :key="s.id" :value="s.id">{{ s.title || 'Шаг' }}</option>
      </template>
      <option v-for="(r, i) in rounds" :key="r.id" :value="r.id">🤖 Ревью, раунд {{ i + 1 }}</option>
    </select>
    <div v-if="error" role="alert">{{ error }}</div>
    <ChatView v-if="shown" :key="shown" :session-id="shown" :no-composer="closed || reviewOpened" />
    <button v-else-if="!loading && !closed" @click="open">Открыть чат {{ task.kind === 'errand' ? 'поручения' : 'задачи' }}</button>
    <span v-else-if="loading">Подготовка чата…</span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChatView, useChatStore, type ChatSession } from '@features/agent-chat'
import { api } from '@core/api'
import type { Task } from '@core/models'
import ReviewRoundCard from './ReviewRoundCard.vue'

const props = defineProps<{ task: Task; defaultAgentId?: string | null; showRounds?: boolean }>()
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
  else if (!closed.value) void open()
}, { immediate: true })
</script>
<style scoped>
.work-chat { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 8px; }
.work-chat > select { padding: 8px; color: inherit; background: var(--bg); border: 1px solid var(--border); }
.round-cards { display: flex; flex-direction: column; gap: 6px; }
.work-chat :deep(.chat) { flex: 1; min-height: 0; }
</style>
