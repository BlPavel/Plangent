<template><div role="radiogroup" :aria-label="label" class="radios" :class="{vertical}"><label v-for="option in options" :key="option.value"><input type="radio" :name="name" :value="option.value" :checked="modelValue===option.value" :disabled="disabled||option.disabled" @change="emit('update:modelValue',option.value)" /><span>{{ option.label }}<small v-if="option.hint">{{ option.hint }}</small></span></label></div></template><script setup lang="ts">
import { getCurrentInstance } from 'vue';
defineProps<{
    modelValue: string;
    options: {
        value: string;
        label: string;
        disabled?: boolean;
        hint?: string;
    }[];
    disabled?: boolean;
    label?: string;
    vertical?: boolean;
}>();
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const name = 'radio-' + getCurrentInstance()!.uid;
</script><style scoped>.radios{display:flex;gap:var(--sp-3);font-size:var(--fs-sm);color:var(--text)}.vertical{flex-direction:column}.radios label{display:flex;align-items:center;gap:var(--sp-2);cursor:pointer}.radios small{display:block;color:var(--text-muted);font-size:var(--fs-xs)}.radios input{accent-color:var(--blue)}.radios input:focus-visible{outline:var(--focus-outline)}</style>
