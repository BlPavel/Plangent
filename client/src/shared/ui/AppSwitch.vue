<template><label class="switch" :class="{disabled}"><input v-bind="$attrs" type="checkbox" role="switch" :checked="modelValue" :disabled="disabled" @change="emit('update:modelValue',($event.target as HTMLInputElement).checked)" /><span class="track" aria-hidden="true" /><span><slot>{{ label }}</slot></span></label></template><script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{
    modelValue: boolean;
    label?: string;
    disabled?: boolean;
}>();
const emit = defineEmits<{
    'update:modelValue': [
        value: boolean
    ];
}>();
</script><style scoped>.switch{display:inline-flex;align-items:center;gap:var(--sp-2);color:var(--text);font-size:var(--fs-sm);cursor:pointer;position:relative}.switch input{position:absolute;opacity:0;width:32px;height:18px}.track{width:32px;height:18px;border-radius:var(--radius-pill);background:var(--border-strong);padding:2px;transition:background var(--motion-fast)}.track:before{content:'';display:block;width:14px;height:14px;border-radius:var(--radius-round);background:var(--text);transition:transform var(--motion-fast)}input:checked+.track{background:var(--blue)}input:checked+.track:before{transform:translateX(14px)}input:focus-visible+.track{outline:var(--focus-outline);outline-offset:2px}.disabled{opacity:.45;cursor:not-allowed}</style>
