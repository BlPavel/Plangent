<template>
  <aside class="task-chats">
    <ChatTabs v-if="chats.length" :items="chats.map((chat, i) => ({ id: chat.id, name: `${label} ${i + 1}`, title: chat.title }))" :selected="selected" :label="`Чаты: ${label}`" @select="$emit('select', $event)" @remove="(id, name) => $emit('remove', id, name)" />
    <div class="chat-body">
      <ChatView v-if="selected" :key="selected" :session-id="selected" :workspace-id="workspaceId" :initial-content="initials[selected]" />
      <slot v-else name="new" />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { ChatTabs, ChatView, type ContentBlock } from '@features/agent-chat'
// The task's analysis or planning chats as tabs: switch between them, delete one, or start a new one (the `new` slot).
defineProps<{ workspaceId?: string | null; label: string; chats: { id: string; title: string }[]; selected: string | null; initials: Record<string, ContentBlock[]> }>()
defineEmits<{ select: [id: string | null]; remove: [id: string, name: string] }>()
</script>
<style scoped>
.task-chats { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
