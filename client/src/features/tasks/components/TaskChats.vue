<template>
  <aside class="task-chats">
    <nav v-if="chats.length" class="chat-tabs" :aria-label="`Чаты: ${label}`">
      <div v-for="(chat, i) in chats" :key="chat.id" class="chat-tab" :class="{ active: selected === chat.id }">
        <button type="button" class="chat-tab-name" :aria-pressed="selected === chat.id" :title="chat.title" @click="$emit('select', chat.id)">{{ label }} {{ i + 1 }}</button>
        <button type="button" class="chat-tab-remove" :aria-label="`Удалить чат ${label} ${i + 1}`" title="Удалить чат" @click="$emit('remove', chat.id, `${label} ${i + 1}`)">×</button>
      </div>
      <AppButton class="chat-new" :class="{ active: !selected }" variant="subtle" size="xs" title="Начать новый чат" @click="$emit('select', null)">+ Новый чат</AppButton>
    </nav>
    <div class="chat-body">
      <ChatView v-if="selected" :key="selected" :session-id="selected" :initial-content="initials[selected]" :draft-text="draftText" />
      <slot v-else name="new" />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { ChatView, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
// The task's analysis or planning chats as tabs: switch between them, delete one, or start a new one (the `new` slot).
defineProps<{ label: string; chats: { id: string; title: string }[]; selected: string | null; initials: Record<string, ContentBlock[]>; draftText?: string }>()
defineEmits<{ select: [id: string | null]; remove: [id: string, name: string] }>()
</script>
<style scoped>
.task-chats { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.chat-tabs { display: flex; align-items: center; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
.chat-tab { flex-shrink: 0; display: flex; align-items: center; margin-bottom: -1px; border-bottom: 2px solid transparent; transition: border-color 0.12s; }
.chat-tab.active { border-bottom-color: var(--blue); }
.chat-tab-name { padding: 8px 4px 8px 12px; background: none; border: none; color: var(--text-muted); font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: color 0.12s; }
.chat-tab-name:hover, .active .chat-tab-name { color: var(--text); }
.chat-tab-remove { width: 18px; height: 18px; margin-right: 4px; padding: 0; display: flex; align-items: center; justify-content: center; background: none; border: none; border-radius: 4px; color: var(--text-faint); font-size: 14px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s, color 0.12s, background 0.12s; }
.chat-tab:hover .chat-tab-remove, .chat-tab.active .chat-tab-remove, .chat-tab-remove:focus-visible { opacity: 1; }
.chat-tab-remove:hover { color: var(--danger-hover); background: var(--danger-soft); }
.chat-tab button:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; border-radius: 4px; }
.chat-new { flex-shrink: 0; margin-left: 6px; }
.chat-new.active { color: var(--blue-hover); background: var(--blue-soft); }
.chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
