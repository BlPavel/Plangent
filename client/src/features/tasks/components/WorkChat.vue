<template>
  <div class="work-chat">
    <div v-if="chatOptions.length > 1" class="chat-pick">
      <AppSelect v-model="selected" :options="chatOptions" size="sm" prefix="Чат" />
    </div>
    <div v-if="error" class="chat-note error" role="alert">{{ error }}</div>
    <!-- A new errand keeps its preparation card until the agent can take the request: the chat opens ready to write. -->
    <WorkPreparing v-if="connecting && !introPassed" :workspace="workspace" :placed="!!task.base_commit" agent-connecting />
    <ChatView v-else-if="shown" :key="shown" :session-id="shown" :workspace-id="workspace?.id ?? null" :no-composer="closed" :start="awaitingBrief" />
    <WorkPreparing v-else-if="task.kind === 'errand' && !closed" :workspace="workspace" :placed="!!task.base_commit" />
    <AppButton variant="ghost" size="sm" v-else-if="!loading && !closed" class="chat-open" @click="open">Открыть чат задачи</AppButton>
    <span v-else-if="loading" class="chat-note">Подготовка чата…</span>
  </div>
</template>
<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import { tasksEndpoints } from '../api'

import { computed, ref, watch } from 'vue'
import { ChatView, useChatStore} from '@features/agent-chat'
import type { Task, Workspace } from '@contracts'
import AppSelect from '@shared/ui/AppSelect.vue'
import WorkPreparing from './WorkPreparing.vue'

const props = defineProps<{ task: Task; workspace?: Workspace | null; defaultAgentId?: string | null }>()
const chats = useChatStore()
const selected = ref(''), primary = ref(''), error = ref(''), loading = ref(false)
const closed = computed(() => props.task.status === 'done')
const mine = computed(() => chats.sessions.filter(s => s.task_id === props.task.id))
const steps = computed(() => mine.value.filter(s => s.role === 'executor'))
const shown = computed(() => selected.value || primary.value)
const chatOptions = computed(() => [
  { value: '', label: props.task.kind === 'errand' ? 'Поручение' : 'Задача (знает всю задачу)' },
  ...(props.task.kind !== 'errand' ? steps.value.map(s => ({ value: s.id, label: s.title || 'Шаг' })) : []),
])
/** A new errand whose agent is still connecting and has had no request yet. */
const connecting = computed(() => {
  const session = chats.sessions.find(s => s.id === shown.value)
  return session?.role === 'errand' && session.status === 'starting' && !!session.metadata.awaiting_brief && !closed.value
})
/** The card is for the very first connection; a later reconnect (a changed agent) shows the chat with its own loading dots. */
const introPassed = ref(false)
watch([connecting, shown], ([isConnecting, id]) => { if (id && !isConnecting) introPassed.value = true }, { immediate: true })
/** A new errand: its chat is open, the developer writes the request. */
const awaitingBrief = computed(() => {
  const session = chats.sessions.find(s => s.id === shown.value)
  return session?.role === 'errand' && !!session.metadata.awaiting_brief && !(chats.snapshots[session.id]?.events ?? []).some(e => e.type === 'user')
})
const primaryRole = computed(() => props.task.kind === 'errand' ? 'errand' : 'task-chat')
watch(() => mine.value.find(s => s.role === primaryRole.value)?.id, id => {
  if (id) { primary.value = id; error.value = '' }
})
async function open() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const chat = await tasksEndpoints.postProjectsByProjectIdTasksByTaskIdChat({ params: { projectId: props.task.project_id, taskId: props.task.id }, body: { agent_id: props.defaultAgentId ?? undefined } })
    chats.put(chat); primary.value = chat.id
  } catch (cause) { error.value = String(cause) }
  finally { loading.value = false }
}
watch(() => props.task.id, () => {
  selected.value = ''; primary.value = ''; error.value = ''; introPassed.value = false
  const existing = mine.value.find(s => s.role === primaryRole.value)
  if (existing) primary.value = existing.id
  // An errand's chat appears by itself once its folder is ready; a task's chat is created on demand.
  else if (!closed.value && props.task.kind !== 'errand') void open()
}, { immediate: true })
</script>
<style scoped>
.work-chat { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 8px; }
.chat-pick { padding: 8px var(--sp-5) 0; }
.chat-note { margin: 0; padding: 10px var(--sp-5) 0; font-size: var(--fs-md); color: var(--text-muted); }
.chat-note.error { color: var(--danger-hover); }
.chat-open { align-self: flex-start; margin: 12px var(--sp-5); }
.work-chat :deep(.chat) { flex: 1; min-height: 0; }
</style>
