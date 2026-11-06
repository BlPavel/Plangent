<template>
  <nav class="chat-tabs" :aria-label="label">
    <div ref="scroller" class="chat-tabs-scroll">
      <AppTabs class="chat-tabs-list" bare rich :model-value="selected ?? ''" :items="items.map(chat => ({ value: chat.id, label: chat.name, title: chat.title }))" :label="label" @update:model-value="$emit('select', $event)">
        <template #item="{ item }">
          <span v-if="statusOf(item.value)" class="chat-dot" :class="statusOf(item.value)" />
          <span class="chat-tab-name">{{ item.label }}</span>
          <AppCount v-if="countOf(item.value)" :value="countOf(item.value)" />
          <AppButton variant="subtle" size="xs" icon :aria-label="`Удалить чат ${item.label}`" title="Удалить чат" @click.stop="$emit('remove', item.value, item.label)"><UIIconClose /></AppButton>
        </template>
      </AppTabs>
      <AppButton class="chat-new" :pressed="!selected" variant="subtle" size="sm" title="Начать новый чат" @click="$emit('select', null)">+ Новый чат</AppButton>
    </div>
    <slot name="actions" />
  </nav>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { IconClose as UIIconClose } from '@shared/ui/icons'
import AppButton from '@shared/ui/AppButton.vue'
import AppCount from '@shared/ui/AppCount.vue'
import AppTabs from '@shared/ui/AppTabs.vue'

/**
 * The strip of an entity's chats with the agent: «План 1», «План 2», … and «+ Новый чат».
 * The same bar serves every place where the developer works with an agent, so they look alike.
 */
export interface ChatTab { id: string; /** «План 1»: the entity and the chat's number */ name: string; /** the chat's own title, shown as a hint */ title?: string; status?: string; count?: number }
const props = defineProps<{ items: ChatTab[]; selected: string | null; label: string }>()
defineEmits<{ select: [id: string | null]; remove: [id: string, name: string] }>()

const statusOf = (id: string) => props.items.find(chat => chat.id === id)?.status
const countOf = (id: string) => props.items.find(chat => chat.id === id)?.count ?? 0

// The chosen tab stays in view when there are more chats than fit.
const scroller = ref<HTMLElement>()
watch(() => props.selected, async id => {
  await nextTick()
  Array.from(scroller.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []).find(el => el.dataset.id === id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
</script>

<style scoped>
.chat-tabs { display: flex; align-items: stretch; gap: var(--sp-2); height: var(--chat-tabs-h, 40px); padding: 0 var(--sp-3); border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
.chat-tabs-scroll { flex: 1; min-width: 0; display: flex; align-items: stretch; gap: var(--sp-1); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.chat-tabs-list { flex-shrink: 0; }
.chat-new { align-self: center; flex-shrink: 0; }
.chat-tab-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-dot { width: 7px; height: 7px; border-radius: var(--radius-round); flex-shrink: 0; background: var(--border-strong); }
.chat-dot.thinking, .chat-dot.starting { background: var(--blue-hover); animation: pulse 1.4s ease-in-out infinite; }
.chat-dot.waiting { background: var(--warning-text); }
.chat-dot.complete, .chat-dot.ready { background: var(--accent-hover); }
.chat-dot.error { background: var(--danger-hover); }
@keyframes pulse { 50% { opacity: 0.35; } }
</style>
