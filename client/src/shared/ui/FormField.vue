<template><div class="form-field"><label v-if="label" :for="id">{{ label }}</label><slot v-if="modelValue === undefined" :id="id" /><AppTextarea v-else-if="type === 'textarea'" :id="id" :model-value="modelValue" :disabled="disabled" :placeholder="placeholder" :rows="rows ?? 3" :size="size" :mono="mono" :invalid="invalid" block @update:model-value="emit('update:modelValue', $event)" /><AppSelect v-else-if="type === 'select'" :id="id" :model-value="modelValue" :options="selectOptions" :disabled="disabled" :label="label" :size="size" block @update:model-value="emit('update:modelValue', $event)" /><AppInput v-else :id="id" :type="type" :model-value="modelValue" :disabled="disabled" :placeholder="placeholder" :size="size" :mono="mono" :invalid="invalid" block @update:model-value="emit('update:modelValue', $event)" /><span v-if="hint" class="hint">{{ hint }}</span></div></template>
<script setup lang="ts">
import { computed, getCurrentInstance, useSlots, type VNode } from 'vue';
import AppInput from './AppInput.vue';
import AppTextarea from './AppTextarea.vue';
import AppSelect, { type SelectOption } from './AppSelect.vue';
const props = withDefaults(defineProps<{
    modelValue?: string;
    label?: string;
    placeholder?: string;
    type?: string;
    rows?: number;
    hint?: string;
    disabled?: boolean;
    options?: SelectOption[];
    size?: 'sm' | 'md';
    mono?: boolean;
    invalid?: boolean;
}>(), { type: 'text', size: 'md' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const id = 'field-' + getCurrentInstance()!.uid, slots = useSlots();
function text(node: VNode): string { return typeof node.children === 'string' ? node.children : Array.isArray(node.children) ? (node.children as VNode[]).map(text).join('') : ''; }
function collectOptions(nodes: VNode[]): SelectOption[] { return nodes.flatMap(node => node.type === 'option' ? [{ value: String(node.props?.value ?? text(node)), label: text(node), disabled: !!node.props?.disabled }] : Array.isArray(node.children) ? collectOptions(node.children as VNode[]) : []); }
const selectOptions = computed(() => props.options ?? collectOptions(slots.default?.() ?? []));
</script>
<style scoped>.form-field { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; } label { font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--text-muted); } .hint { font-size: var(--fs-xs); color: var(--text-faint); }</style>
