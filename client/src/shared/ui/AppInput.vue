<template><input ref="element" class="control-input" :class="[size, { mono, invalid, block }]" :value="modelValue" :aria-invalid="invalid || undefined" :style="autosize ? { width: Math.max(1, modelValue?.length ?? 0) + 'ch' } : undefined" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" /></template>
<script setup lang="ts">
import { ref } from 'vue';
withDefaults(defineProps<{
    modelValue?: string;
    size?: 'sm' | 'md';
    mono?: boolean;
    invalid?: boolean;
    block?: boolean;
    autosize?: boolean;
}>(), { size: 'md' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const element = ref<HTMLInputElement>();
defineExpose({ focus: () => element.value?.focus(), select: () => element.value?.select?.(), element });
</script>
<style scoped>@import './styles/controls.css';</style>
