<template>
  <aside class="task-chats">
    <nav v-if="chats.length" class="chat-tabs" :aria-label="`Чаты: ${label}`">
      <AppTabs :model-value="selected ?? ''" :items="chats.map((chat, i) => ({ value: chat.id, label: `${label} ${i + 1}`, title: chat.title }))" rich :label="`Чаты: ${label}`" @update:model-value="$emit('select', $event)">
        <template #item="{ item }">
          {{ item.label }}
          <AppButton variant="subtle" size="xs" icon :aria-label="`Удалить чат ${item.label}`" title="Удалить чат" @click.stop="$emit('remove', item.value, item.label)"><UIIconClose /></AppButton>
        </template>
      </AppTabs>
      <AppButton class="chat-new" :pressed="!selected" variant="subtle" size="xs" title="Начать новый чат" @click="$emit('select', null)">+ Новый чат</AppButton>
    </nav>
    <div class="chat-body">
      <ChatView v-if="selected" :key="selected" :session-id="selected" :workspace-id="workspaceId" :initial-content="initials[selected]" />
      <slot v-else name="new" />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { IconClose as UIIconClose } from '@shared/ui/icons'
import { ChatView, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
// The task's analysis or planning chats as tabs: switch between them, delete one, or start a new one (the `new` slot).
defineProps<{ workspaceId?: string | null; label: string; chats: { id: string; title: string }[]; selected: string | null; initials: Record<string, ContentBlock[]> }>()
defineEmits<{ select: [id: string | null]; remove: [id: string, name: string] }>()
</script>
<style scoped>
.task-chats { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.chat-tabs { display: flex; align-items: center; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
.chat-tab { flex-shrink: 0; display: flex; align-items: center; margin-bottom: -1px; border-bottom: 2px solid transparent; transition: border-color var(--motion-fast); }
.chat-tab.active { border-bottom-color: var(--blue); }
.chat-tab-name { padding: 8px 4px 8px 12px; background: none; border: none; color: var(--text-muted); font-family: inherit; font-size: var(--fs-sm); font-weight: 500; cursor: pointer; transition: color var(--motion-fast); }
.chat-tab-name:hover, .active .chat-tab-name { color: var(--text); }
.chat-tab-remove { width: 18px; height: 18px; margin-right: 4px; padding: 0; display: flex; align-items: center; justify-content: center; background: none; border: none; border-radius: var(--radius-4); color: var(--text-faint); font-size: var(--fs-base); line-height: 1; cursor: pointer; opacity: 0; transition: opacity var(--motion-fast), color var(--motion-fast), background var(--motion-fast); }
.chat-tab:hover .chat-tab-remove, .chat-tab.active .chat-tab-remove, .chat-tab-remove:focus-visible { opacity: 1; }
.chat-tab-remove:hover { color: var(--danger-hover); background: var(--danger-soft); }
.chat-tab button:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; border-radius: var(--radius-4); }
.chat-new { flex-shrink: 0; margin-left: 6px; }
.chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
