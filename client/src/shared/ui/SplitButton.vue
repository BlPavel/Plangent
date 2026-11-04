<template>
  <span class="split" :class="'split-' + variant">
    <AppButton join="start" :variant="variant" :size="size" :disabled="disabled" :title="title" @click="emit('click')"><slot /></AppButton>
    <AppMenu join="end" :trigger-variant="variant" :items="items" icon="chevron" :size="size" compact :title="menuTitle" :disabled="menuDisabled" align="right" />
  </span>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue';
import AppMenu, { type MenuItem } from './AppMenu.vue';
/** The main action with a ▾ list of related ones beside it, as in Zed's git panel. */
withDefaults(defineProps<{
    items: MenuItem[];
    variant?: 'subtle' | 'blue' | 'ghost';
    size?: 'sm' | 'xs';
    disabled?: boolean;
    menuDisabled?: boolean;
    title?: string;
    menuTitle?: string;
}>(), { variant: 'subtle', size: 'sm', disabled: false, menuDisabled: false, title: '', menuTitle: 'Другие действия' });
const emit = defineEmits<{
    click: [
    ];
}>();
</script>

<style scoped>
.split { display: inline-flex; align-items: stretch; }
</style>
