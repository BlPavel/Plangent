<template>
  <div class="chats">
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="sidebar-title">Чаты</span>
        <AppButton variant="primary" size="sm" title="Новый чат" @click="selected = ''">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
          Новый
        </AppButton>
      </div>
      <div class="sidebar-list">
        <div v-if="!sessions.length" class="sidebar-empty">Здесь появятся ваши чаты с агентами</div>
        <div
          v-for="session in sessions"
          :key="session.id"
          class="chat-item"
          :class="{ active: selected === session.id }"
          title="Двойной клик — переименовать"
          @click="selected = session.id"
          @dblclick="startRename(session)"
        >
          <span class="chat-dot" :class="session.status" />
          <div class="chat-item-body">
            <div class="chat-item-title">{{ session.title }}</div>
            <div class="chat-item-meta">{{ agentName(session.agent_id) }}<template v-if="session.updated_at"> · {{ ago(session.updated_at) }}</template></div>
          </div>
          <button class="chat-item-delete" title="Удалить чат" @click.stop="remove(session)"><IconTrash /></button>
        </div>
      </div>
    </aside>

    <main class="main">
      <ChatView
        v-if="selected"
        :key="selected"
        :session-id="selected"
        :initial-content="initial?.id === selected ? initial.content : undefined"
        @session="selected = $event"
      />
      <NewChatPanel
        v-else
        :project-id="projectId"
        :default-agent-id="defaultAgentId"
        title="Новый чат"
        text="Выберите агента и опишите задачу. Агент работает в папке проекта; модель, режим и остальное можно поменять и во время чата."
        :busy="creating"
        :error="error"
        @start="create"
      />
    </main>

    <AppModal :model-value="!!renameId" title="Название чата" @update:model-value="renameId = ''" @confirm="rename"><FormField v-model="title" label="Название" /></AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '@core/api'
import { useAgentsStore } from '@features/agents'
import { useAppStore } from '@core/stores/app'
import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import ChatView from './ChatView.vue'
import type { ContentBlock } from './ChatComposer.vue'
import NewChatPanel, { type NewChatRequest } from './NewChatPanel.vue'
import { useChatStore, type ChatSession } from '../stores/sessions'

const props = defineProps<{ projectId: string; defaultAgentId?: string | null }>()
const store = useChatStore(), agents = useAgentsStore(), app = useAppStore()
const selected = ref(''), error = ref(''), creating = ref(false), renameId = ref(''), title = ref('')
const initial = ref<{ id: string; content: ContentBlock[] } | null>(null)

const sessions = computed(() => store.sessions.filter(s => s.project_id === props.projectId && s.role === 'chat'))
const agentName = (id: string) => agents.agents.find(a => a.id === id)?.name ?? ''

watch(() => props.projectId, () => { selected.value = ''; void store.connect() }, { immediate: true })
// The first message is handed to ChatView once; never resend it when the chat is reopened.
watch(selected, id => { if (initial.value && initial.value.id !== id) initial.value = null })

async function create({ content, ...options }: NewChatRequest) {
  creating.value = true
  error.value = ''
  try {
    const session = await api.post<ChatSession>('/agent-sessions', { project_id: props.projectId, ...options })
    store.put(session)
    initial.value = { id: session.id, content }
    selected.value = session.id
  } catch (e) { error.value = String(e) }
  finally { creating.value = false }
}
function startRename(session: ChatSession) { renameId.value = session.id; title.value = session.title }
async function rename() { store.put(await api.patch<ChatSession>(`/agent-sessions/${renameId.value}`, { title: title.value })); renameId.value = '' }
async function remove(session: ChatSession) {
  if (!(await app.confirm(`Удалить чат "${session.title}"?`))) return
  try { await store.remove(session.id); if (selected.value === session.id) selected.value = '' }
  catch (e) { app.toast(String(e), 'error') }
}

function ago(timestamp: string) {
  const date = new Date(timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z')
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ч`
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
</script>

<style scoped>
.chats { display: flex; height: 100%; min-height: 0; }

.sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg); }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 var(--sp-3) 0 var(--sp-4); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sidebar-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.sidebar-list { flex: 1; overflow-y: auto; padding: var(--sp-2); display: flex; flex-direction: column; gap: 2px; }
.sidebar-empty { padding: var(--sp-4) var(--sp-2); font-size: 12px; color: var(--text-faint); text-align: center; }

.chat-item { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 10px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; }
.chat-item:hover { background: var(--bg2); }
.chat-item.active { background: var(--bg3); }
.chat-item-body { flex: 1; min-width: 0; }
.chat-item-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-item-meta { font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-item-delete { width: 24px; height: 24px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; border-radius: var(--radius-sm); color: var(--text-faint); cursor: pointer; opacity: 0; transition: opacity 0.1s, color 0.1s, background 0.1s; }
.chat-item-delete svg { width: 14px; height: 14px; }
.chat-item:hover .chat-item-delete { opacity: 1; }
.chat-item-delete:hover { color: var(--danger-hover); background: var(--danger-soft); }

.chat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--border-strong); }
.chat-dot.thinking, .chat-dot.starting { background: var(--blue-hover); animation: pulse 1.4s ease-in-out infinite; }
.chat-dot.waiting { background: var(--warning-text); box-shadow: 0 0 0 3px var(--warning-soft); }
.chat-dot.complete, .chat-dot.ready { background: var(--accent-hover); }
.chat-dot.error { background: var(--danger-hover); }
@keyframes pulse { 50% { opacity: 0.35; } }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
