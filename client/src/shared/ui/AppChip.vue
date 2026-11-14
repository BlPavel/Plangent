<template><span class="chip"><slot /><AppButton v-if="removable" size="xs" variant="subtle" icon :disabled="disabled" :aria-label="removeLabel" @click="$emit('remove')"><IconClose /></AppButton></span></template><script setup lang="ts">
import AppButton from './AppButton.vue';
import { IconClose } from './icons';
withDefaults(defineProps<{
    removable?: boolean;
    removeLabel?: string;
    disabled?: boolean;
}>(), { removeLabel: 'Убрать' });
defineEmits<{
    remove: [
    ];
}>();
</script><style scoped>.chip{display:inline-flex;align-items:center;gap:var(--sp-1);padding:2px var(--sp-2);border:1px solid var(--border-strong);border-radius:var(--radius-pill);background:var(--bg3);color:var(--text);font-size:var(--fs-sm)}</style>
