<template>
  <aside class="librarian">
    <header class="head">
      <span class="head-title">Запись с агентом</span>
      <div ref="tabScroller" class="chat-tabs">
        <AppTabs class="chat-tab-list" bare :model-value="selected" :items="sessions.map(session => ({ value: session.id, label: session.title, title: session.title }))" rich label="Чаты с библиотекарем" @update:model-value="selected = $event">
          <template #item="{ item }"><span class="dot" :class="sessions.find(session => session.id === item.value)?.status" /><span class="chat-tab-title">{{ item.label }}</span><AppCount v-if="pendingIn(item.value)" :value="pendingIn(item.value)" /></template>
        </AppTabs>
      </div>
      <AppButton variant="subtle" size="xs" :pressed="!selected" title="Новый чат с библиотекарем" @click="newChat">+ Новый</AppButton>
      <AppButton v-if="selected" variant="danger-ghost" size="xs" icon title="Удалить чат" @click="remove"><IconTrash /></AppButton>
      <AppButton variant="ghost" size="xs" icon title="Скрыть панель" @click="$emit('close')"><UIIconClose /></AppButton>
    </header>

    <div v-if="selected && noProposalYet" class="nudge">
      Агент пока ничего не предложил. Библиотека меняется только через карточку предложения.
      <AppButton variant="link" size="md" type="button"  @click="chat?.setText('Оформи это предложением изменения библиотеки.')">Попросить оформить</AppButton>
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
      <NewChatPanel :draft-key="newChatDraftKey"
        v-else
        :project-id="projectId"
        :default-agent-id="defaultAgentId"
        :initial-text="startText"
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
import { AppCount, AppTabs } from '@shared/ui'
import { IconClose as UIIconClose } from '@shared/ui/icons'
import { agentChatEndpoints } from '@features/agent-chat'

import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useDraftsStore } from '@core/stores/drafts'
import { useAgentsStore } from '@features/agents'
import { ChatView, NewChatPanel, useChatStore, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { useLibraryStore } from '../stores/library'
import ProposalCard from './ProposalCard.vue'
import type { LibraryScope } from '@contracts'
import { librarySectionForType } from '../../../../../common/library-registry'

/** `request` starts a new chat with the developer's wish already written (the «Изменить с агентом» buttons). */
const props = defineProps<{ projectId: string; libraryScope?: LibraryScope; section?: string; defaultAgentId?: string | null; request?: { text: string; at: number } | null }>()
defineEmits<{ close: [] }>()
const chats = useChatStore(), agents = useAgentsStore(), library = useLibraryStore(), app = useAppStore(), router = useRouter()
const selected = ref(''), creating = ref(false), error = ref('')
const initial = ref<{ id: string; content: ContentBlock[] } | null>(null)
const chat = ref<InstanceType<typeof ChatView> | null>(null)
const startText = ref('')
const drafts = useDraftsStore()
const newChatDraftKey = computed(() => `project:${props.projectId}:librarian-chat:${props.libraryScope ?? 'project'}:${props.section ?? 'items'}`)
const tabScroller = ref<HTMLElement>()
watch(() => props.request?.at, () => { if (props.request) { startText.value = props.request.text; newChat() } }, { immediate: true })

function newChat() {
  const draft = drafts.drafts[newChatDraftKey.value] as { text: string; attachments: unknown[] } | undefined
  if (draft && !draft.text && !draft.attachments.length) drafts.clear(newChatDraftKey.value)
  selected.value = ''
}

function sessionSection(id: string, metadata: Record<string, unknown>): string {
  if (typeof metadata.library_section === 'string') return metadata.library_section
  // Older chats can be assigned only when their saved proposals identify one section.
  const sections = new Set(library.proposalsFor({ sessionId: id }).map(p => {
    return librarySectionForType(props.libraryScope ?? 'project', p.type) ?? p.type
  }))
  return sections.size === 1 ? [...sections][0] : 'items'
}
const sessions = computed(() => chats.sessions.filter(s => s.project_id === props.projectId && s.role === 'librarian' && (s.metadata.library_scope ?? 'project') === (props.libraryScope ?? 'project') && sessionSection(s.id, s.metadata) === (props.section ?? 'items')))
const pendingIn = (sessionId: string) => library.proposalsFor({ sessionId }).filter(p => p.status === 'pending').length

// The latest librarian chat opens by default; a new one starts from the start screen.
watch(() => props.projectId, id => {
  void Promise.all([chats.connect(), library.loadProposals(id)]).then(() => {
    if (props.projectId === id) selected.value = startText.value ? '' : sessions.value[0]?.id ?? ''
  }).catch(e => app.toast(String(e), 'error'))
}, { immediate: true })
watch(selected, id => { if (initial.value && initial.value.id !== id) initial.value = null })
watch(selected, async id => {
  await nextTick()
  const tab = Array.from(tabScroller.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []).find(el => el.dataset.id === id)
  tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})

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
    const session = await agentChatEndpoints.postAgentSessions({ params: {  }, body: { project_id: props.projectId, role: 'librarian', ...options, library_scope: props.libraryScope, library_section: props.section ?? 'items' } })
    chats.put(session)
    initial.value = { id: session.id, content }
    selected.value = session.id
    drafts.clear(newChatDraftKey.value)
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
.head-title { font-size: var(--fs-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); white-space: nowrap; margin-right: 4px; }
.chat-tabs { flex: 1; min-width: 0; align-self: stretch; overflow-x: auto; overflow-y: hidden; }
.chat-tab-list { width: max-content; min-width: 100%; height: 100%; }
.chat-tab-title { max-width: 180px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dot { width: 7px; height: 7px; border-radius: var(--radius-round); flex-shrink: 0; background: var(--border-strong); }
.dot.thinking, .dot.starting { background: var(--blue-hover); animation: pulse 1.4s ease-in-out infinite; }
.dot.waiting { background: var(--warning-text); }
.dot.complete, .dot.ready { background: var(--accent-hover); }
.dot.error { background: var(--danger-hover); }
@keyframes pulse { 50% { opacity: 0.35; } }

.nudge { padding: 8px var(--sp-4); font-size: var(--fs-sm); color: var(--text-muted); background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.link { background: none; border: none; padding: 0; margin-left: 4px; font: inherit; color: var(--blue-hover); cursor: pointer; }
.link:hover { text-decoration: underline; }

.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.empty { margin: auto; max-width: 340px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: var(--sp-6); }
.empty-title { font-size: var(--fs-lg); font-weight: 600; }
.empty-text { font-size: var(--fs-md); color: var(--text-muted); }
</style>
