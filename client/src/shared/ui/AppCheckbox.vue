<template><label class="check" :class="{ disabled, block }"><input ref="input" v-bind="$attrs" type="checkbox" :checked="modelValue" :disabled="disabled" :aria-invalid="invalid || undefined" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /><span><slot>{{ label }}</slot></span></label></template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps<{
    modelValue: boolean;
    label?: string;
    disabled?: boolean;
    invalid?: boolean;
    indeterminate?: boolean;
    /** Full-width row, so a list of checkboxes stacks vertically. */
    block?: boolean;
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
<style scoped>
.check { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--text); font: var(--fs-sm)/var(--lh-normal) var(--font-sans); cursor: pointer; }
.check input { flex-shrink: 0; width: 14px; height: 14px; margin: 0; cursor: inherit; accent-color: var(--blue); }
.check input:focus-visible { outline: var(--focus-outline); }
.check.block { display: flex; padding: var(--sp-2); border-radius: var(--radius-sm); }
.check.block:hover { background: var(--bg-hover); }
.disabled { opacity: .45; cursor: not-allowed; }
</style>
