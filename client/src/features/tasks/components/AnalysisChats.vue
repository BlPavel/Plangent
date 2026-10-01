<template>
  <aside class="analysis-chats">
    <nav v-if="chats.length" class="chat-tabs" aria-label="Чаты анализа">
      <button
        v-for="(chat, i) in chats" :key="chat.sessionId" type="button" class="chat-tab" :class="{ active: selected === chat.sessionId }"
        :aria-pressed="selected === chat.sessionId" @click="$emit('select', chat.sessionId)"
      >Анализ {{ i + 1 }}</button>
      <AppButton class="chat-new" :class="{ active: !selected }" variant="subtle" size="xs" title="Начать новый чат анализа" @click="$emit('select', null)">+ Новый чат</AppButton>
    </nav>
    <div class="chat-body">
      <ChatView v-if="selected" :key="selected" :session-id="selected" :initial-content="initials[selected]" />
      <NewChatPanel v-else :project-id="projectId" :default-agent-id="defaultAgentId" title="Анализ задачи" text="Обсудите материалы. Агент сохранит результаты в разделы анализа." fixed-policy="read-only" :busy="busy" :error="error" @start="$emit('launch', $event)" />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { ChatView, NewChatPanel, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import type { AnalysisChatSnapshot } from '../stores/taskSession'
defineProps<{ projectId: string; defaultAgentId?: string | null; chats: AnalysisChatSnapshot[]; selected: string | null; initials: Record<string, ContentBlock[]>; busy: boolean; error: string }>()
defineEmits<{ select: [id: string | null]; launch: [request: NewChatRequest] }>()
</script>
<style scoped>
.analysis-chats { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.chat-tabs { display: flex; align-items: center; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
.chat-tab { flex-shrink: 0; padding: 8px 12px; margin-bottom: -1px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: color 0.12s, border-color 0.12s; }
.chat-tab:hover { color: var(--text); }
.chat-tab.active { color: var(--text); border-bottom-color: var(--blue); }
.chat-tab:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; border-radius: 4px; }
.chat-new { flex-shrink: 0; margin-left: 6px; }
.chat-new.active { color: var(--blue-hover); background: var(--blue-soft); }
.chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
