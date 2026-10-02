<template>
  <aside class="librarian">
    <header class="head">
      <span class="head-title">Запись с агентом</span>
      <nav class="tabs" aria-label="Чаты с библиотекарем">
        <button
          v-for="session in sessions" :key="session.id" type="button" class="tab" :class="{ active: selected === session.id }"
          :title="session.title" @click="selected = session.id"
        ><span class="dot" :class="session.status" />{{ session.title }}<span v-if="pendingIn(session.id)" class="count">{{ pendingIn(session.id) }}</span></button>
      </nav>
      <AppButton variant="subtle" size="xs" :class="{ active: !selected }" title="Новый чат с библиотекарем" @click="selected = ''">+ Новый</AppButton>
      <AppButton v-if="selected" variant="danger-ghost" size="xs" icon title="Удалить чат" @click="remove"><IconTrash /></AppButton>
      <AppButton variant="ghost" size="xs" icon title="Скрыть панель" @click="$emit('close')">×</AppButton>
    </header>

    <div v-if="selected && noProposalYet" class="nudge">
      Агент пока ничего не предложил. Библиотека меняется только через карточку предложения.
      <button type="button" class="link" @click="chat?.setText('Оформи это предложением изменения библиотеки.')">Попросить оформить</button>
    </div>

    <div class="body">
      <ChatView
        v-if="selected" ref="chat" :key="selected" :session-id="selected" :initial-content="initial?.id === selected ? initial.content : undefined"
        :cards="['propose_library_change']" @session="selected = $event"
      >
        <template #card="{ event }">
          <ProposalCard :proposal-id="event.payload.proposal_id ?? ''" @discuss="chat?.setText($event)" />
        </template>
      </ChatView>
      <div v-else-if="!agents.agents.length" class="empty">
        <div class="empty-title">Нет агентов</div>
        <div class="empty-text">Добавьте агента в настройках, чтобы записывать инструкции вместе с ним.</div>
        <AppButton size="sm" @click="router.push('/settings')">Открыть настройки</AppButton>
      </div>
      <NewChatPanel
        v-else
        :project-id="projectId"
        :default-agent-id="defaultAgentId"
        title="Запись инструкций"
        text="Опишите, что нужно: новый скилл, правило после ошибки агента, команда. Агент изучит библиотеку и код (только чтение) и предложит изменение — вы проверите его и примените."
        placeholder="Например: нужен скилл про то, как у нас устроены диалоги"
        fixed-policy="read-only"
        :busy="creating"
        :error="error"
        @start="create"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { ChatView, NewChatPanel, useChatStore, type ChatSession, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { useLibraryStore } from '../stores/library'
import ProposalCard from './ProposalCard.vue'

const props = defineProps<{ projectId: string; defaultAgentId?: string | null }>()
defineEmits<{ close: [] }>()
const chats = useChatStore(), agents = useAgentsStore(), library = useLibraryStore(), app = useAppStore(), router = useRouter()
const selected = ref(''), creating = ref(false), error = ref('')
const initial = ref<{ id: string; content: ContentBlock[] } | null>(null)
const chat = ref<InstanceType<typeof ChatView> | null>(null)

const sessions = computed(() => chats.sessions.filter(s => s.project_id === props.projectId && s.role === 'librarian'))
const pendingIn = (sessionId: string) => library.proposalsFor({ sessionId }).filter(p => p.status === 'pending').length

// The latest librarian chat opens by default; a new one starts from the start screen.
watch(() => props.projectId, () => { void chats.connect().then(() => { selected.value = sessions.value[0]?.id ?? '' }) }, { immediate: true })
watch(selected, id => { if (initial.value && initial.value.id !== id) initial.value = null })

// After a finished turn with an answer but no proposal the agent may have only talked; offer to ask for one.
const noProposalYet = computed(() => {
  const snap = chats.snapshots[selected.value]
  if (!snap || ['thinking', 'starting'].includes(snap.session.status)) return false
  return snap.events.some(e => e.type === 'assistant') && !library.proposalsFor({ sessionId: selected.value }).length
})

async function create({ content, ...options }: NewChatRequest) {
  creating.value = true
  error.value = ''
  try {
    const session = await api.post<ChatSession>('/agent-sessions', { project_id: props.projectId, role: 'librarian', ...options })
    chats.put(session)
    initial.value = { id: session.id, content }
    selected.value = session.id
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { creating.value = false }
}

async function remove() {
  const session = sessions.value.find(s => s.id === selected.value)
  if (!session || !(await app.confirm(`Удалить чат «${session.title}»? Применённые изменения останутся в библиотеке.`))) return
  try { await chats.remove(session.id); selected.value = sessions.value[0]?.id ?? '' }
  catch (e) { app.toast(String(e), 'error') }
}
</script>

<style scoped>
.librarian { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; background: var(--bg); }
.head { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.head-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); white-space: nowrap; margin-right: 4px; }
.tabs { flex: 1; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; align-self: stretch; }
.tab { flex-shrink: 0; max-width: 180px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; margin-bottom: -1px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--blue); }
.count { font-size: 10px; font-weight: 600; min-width: 16px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); text-align: center; }
.active { color: var(--blue-hover); }

.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--border-strong); }
.dot.thinking, .dot.starting { background: var(--blue-hover); animation: pulse 1.4s ease-in-out infinite; }
.dot.waiting { background: var(--warning-text); }
.dot.complete, .dot.ready { background: var(--accent-hover); }
.dot.error { background: var(--danger-hover); }
@keyframes pulse { 50% { opacity: 0.35; } }

.nudge { padding: 8px var(--sp-4); font-size: 12px; color: var(--text-muted); background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.link { background: none; border: none; padding: 0; margin-left: 4px; font: inherit; color: var(--blue-hover); cursor: pointer; }
.link:hover { text-decoration: underline; }

.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.empty { margin: auto; max-width: 340px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: var(--sp-6); }
.empty-title { font-size: 16px; font-weight: 600; }
.empty-text { font-size: 13px; color: var(--text-muted); }
</style>
