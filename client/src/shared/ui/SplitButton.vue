<template>
  <span class="split" :class="'split-' + variant">
    <button type="button" class="btn split-main" :class="['btn-' + variant, 'btn-' + size]" :disabled="disabled" :title="title" @click="emit('click')"><slot /></button>
    <AppMenu class="split-more" :items="items" icon="chevron" :size="size" compact :title="menuTitle" :disabled="menuDisabled" align="right" />
  </span>
</template>

<script setup lang="ts">
import AppMenu, { type MenuItem } from './AppMenu.vue'

/** The main action with a ▾ list of related ones beside it, as in Zed's git panel. */
withDefaults(defineProps<{
  items: MenuItem[]; variant?: 'subtle' | 'blue' | 'ghost'; size?: 'sm' | 'xs'; disabled?: boolean; menuDisabled?: boolean; title?: string; menuTitle?: string
}>(), { variant: 'subtle', size: 'sm', disabled: false, menuDisabled: false, title: '', menuTitle: 'Другие действия' })
const emit = defineEmits<{ click: [] }>()
</script>

<style scoped>
.split { display: inline-flex; align-items: stretch; }
.split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.split-more :deep(.btn) { width: 22px; height: 100%; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 1px solid rgba(0, 0, 0, 0.25); }
.split-ghost .split-more :deep(.btn) { color: var(--text); background: var(--bg3); border-color: var(--border-strong); }
.split-blue .split-more :deep(.btn) { color: #fff; background: var(--blue); }
.split-blue .split-more :deep(.btn:hover:not(:disabled)) { background: var(--blue-hover); }
</style>
