<template><textarea ref="element" class="control-input textarea" :class="[size, { mono, invalid, warning, block, composer }]" :value="modelValue" :aria-invalid="invalid || undefined" @input="input" /></template>
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
const props = withDefaults(defineProps<{
    modelValue?: string;
    size?: 'sm' | 'md';
    mono?: boolean;
    invalid?: boolean;
    warning?: boolean;
    block?: boolean;
    autosize?: boolean;
    composer?: boolean;
}>(), { size: 'md' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const element = ref<HTMLTextAreaElement>();
function resize() { if (props.autosize && element.value) {
    element.value.style.height = 'auto';
    element.value.style.height = element.value.scrollHeight + 'px';
} }
function input(event: Event) { emit('update:modelValue', (event.target as HTMLTextAreaElement).value); resize(); }
watch(() => [props.modelValue, props.autosize], () => void nextTick(resize));
onMounted(resize);
defineExpose({ focus: () => element.value?.focus(), select: () => element.value?.select?.(), element });
</script>
<style scoped>@import './styles/controls.css'; .warning { border-color: var(--warning); } .composer { width: 100%; min-height: 44px; max-height: 240px; padding: 12px 14px 4px; resize: none; background: transparent; border: none; outline: none; color: var(--text); font: var(--fs-base)/var(--lh-normal) var(--font-sans); }</style>
