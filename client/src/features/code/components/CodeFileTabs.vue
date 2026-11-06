<template>
  <div class="cft">
    <div class="cft-scroll">
      <AppTabs
        rich bare draggable @tab-dragstart="(path, event) => dragMention(event, path)" :model-value="active ?? ''" :items="files.map(file => ({ value: file.path, label: nameOf(file.path), title: file.path }))" label="Открытые файлы"
        @update:model-value="emit('select', $event)" @tab-middle="emit('close', $event)"
      >
        <template #item="{ item }">
          <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
          <span class="cft-icon" v-html="iconSvg(fileIconName(item.label))" />
          <span class="cft-name">{{ item.label }}</span>
          <span v-if="statuses[item.value]" class="cft-status" :class="'st-' + statusClass(statuses[item.value])">{{ statuses[item.value] }}</span>
          <AppButton variant="subtle" size="xs" icon tabindex="-1" title="Закрыть" :aria-label="'Закрыть ' + item.label" @click.stop="emit('close', item.value)" @mousedown.middle.stop>
            <UIIconClose />
          </AppButton>
        </template>
      </AppTabs>
    </div>
    <AppButton variant="subtle" size="xs" icon class="cft-all" title="Закрыть все файлы" aria-label="Закрыть все файлы" @click="emit('close-all')">
      <UIIconClose />
    </AppButton>
  </div>
</template>

<script setup lang="ts">
import { useMentionDrag } from '../composables/useMentionDrag'
import { IconClose as UIIconClose } from '@shared/ui/icons'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import { fileIconName, iconSvg } from '@shared/code-viewer'


/** Tabs of the files opened in the side panel; `statuses` marks changed files by their git letter. */
defineProps<{ files: { path: string }[]; active: string | null; statuses: Record<string, string> }>()
const dragMention = useMentionDrag()
const emit = defineEmits<{ select: [path: string]; close: [path: string]; 'close-all': [] }>()
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const statusClass = (status: string) => (status === '?' ? 'A' : status === 'C' ? 'R' : status)
</script>

<style scoped>
.cft { display: flex; align-items: stretch; flex-shrink: 0; height: 34px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.cft-scroll { flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.cft-icon { display: inline-flex; width: 16px; height: 16px; }
.cft-icon :deep(svg) { width: 16px; height: 16px; }
.cft-status { font-size: var(--fs-xs); font-weight: 600; }
.st-M, .st-R { color: var(--warning-text); }
.st-A { color: var(--accent-hover); }
.st-D, .st-U { color: var(--danger-hover); }
.cft-all { align-self: center; margin: 0 6px; }
</style>
