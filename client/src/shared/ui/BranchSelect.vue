<template><AppCombobox v-bind="$attrs" :model-value="modelValue" :options="options" :small="small" :placeholder="placeholder" :label="label" :disabled="disabled" :empty-label="emptyLabel" @update:model-value="$emit('update:modelValue', $event)" /></template><script setup lang="ts">
import AppCombobox from './AppCombobox.vue';
defineProps<{
    modelValue: string;
    options: {
        value: string;
        label: string;
    }[];
    small?: boolean;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    emptyLabel?: string;
}>();
defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
</script>
