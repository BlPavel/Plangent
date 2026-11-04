<template><label class="check" :class="{ disabled }"><input ref="input" v-bind="$attrs" type="checkbox" :checked="modelValue" :disabled="disabled" :aria-invalid="invalid || undefined" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /><span><slot>{{ label }}</slot></span></label></template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps<{
    modelValue: boolean;
    label?: string;
    disabled?: boolean;
    invalid?: boolean;
    indeterminate?: boolean;
}>();
const emit = defineEmits<{
    'update:modelValue': [
        value: boolean
    ];
}>();
const input = ref<HTMLInputElement>();
watchEffect(() => { if (input.value)
    input.value.indeterminate = !!props.indeterminate; });
defineExpose({ focus: () => input.value?.focus() });
</script>
<style scoped>.check{display:inline-flex;align-items:center;gap:var(--sp-2);font:var(--fs-sm)/var(--lh-normal) var(--font-sans);color:var(--text);cursor:pointer}.check input{accent-color:var(--blue);width:16px;height:16px}.check input:focus-visible{outline:var(--focus-outline)}.disabled{opacity:.45;cursor:not-allowed}</style>
