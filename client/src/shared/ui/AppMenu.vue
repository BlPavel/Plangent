<template><span ref="root" class="menu"><AppButton :variant="triggerVariant" :size="size" :join="join" icon :disabled="disabled" :title="title" :aria-label="title" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open" @keydown.down.prevent="open = true"><IconChevron v-if="icon === 'chevron'" /><IconDots v-else /></AppButton><AppPopover focus-on-open v-model="open" :anchor="root" :align="align" :min-width="minWidth" role="menu"><template v-for="(item, i) in items" :key="i"><div v-if="item.separator" class="separator" /><div v-else-if="item.heading" class="heading">{{ item.heading }}</div><button v-else type="button" role="menuitem" class="option" :class="{ danger: item.danger }" :disabled="item.disabled" :title="compact ? item.hint : undefined" @click="pick(item)"><span>{{ item.label }}<span v-if="item.hint && !compact" class="description">{{ item.hint }}</span></span></button></template></AppPopover></span></template>
<script setup lang="ts">
import { ref } from 'vue';
import AppButton, { type ButtonVariant } from './AppButton.vue';
import AppPopover from './AppPopover.vue';
import { IconChevron, IconDots } from './icons';
export interface MenuItem {
    label?: string;
    hint?: string;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    heading?: string;
    action?: () => void;
}
withDefaults(defineProps<{
    items: MenuItem[];
    title?: string;
    size?: 'md' | 'sm' | 'xs';
    align?: 'left' | 'right';
    icon?: 'dots' | 'chevron';
    disabled?: boolean;
    compact?: boolean;
    minWidth?: number;
    triggerVariant?: ButtonVariant;
    join?: 'start' | 'end';
}>(), { title: 'Ещё', size: 'sm', align: 'right', triggerVariant: 'subtle', minWidth: 220 });
const root = ref<HTMLElement>(), open = ref(false);
function pick(item: MenuItem) { if (item.disabled)
    return; open.value = false; item.action?.(); }
</script>
<style scoped>@import './styles/options.css'; .menu { display: inline-flex; }</style>
