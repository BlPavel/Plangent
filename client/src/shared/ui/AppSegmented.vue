<template><AppTabs :model-value="modelValue" :items="options" :label="label" segmented @update:model-value="$emit('update:modelValue',$event)" /></template><script setup lang="ts">
import AppTabs from './AppTabs.vue';
defineProps<{
    modelValue: string;
    options: {
        value: string;
        label: string;
        disabled?: boolean;
    }[];
    label?: string;
}>();
defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
</script>
