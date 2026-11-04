<template><span ref="root" class="combobox" :class="{ block }"><AppInput ref="input" :model-value="open ? query : shown" :size="small ? 'sm' : size" :disabled="disabled" :placeholder="placeholder" :aria-label="label" role="combobox" :aria-expanded="open" aria-autocomplete="list" :block="block" @focus="show" @click="show" @update:model-value="query = $event; typed = true; open = true; active = 0" @keydown="key" @blur="blur" /><AppPopover v-model="open" :anchor="root" role="listbox"><button v-for="(item, index) in filtered" :key="item.value" type="button" role="option" class="option" :class="{ active: index === active }" :disabled="item.disabled" :aria-selected="item.value === modelValue" @pointerdown.prevent @click="pick(item.value)">{{ item.label }}</button><div v-if="!filtered.length" class="heading">{{ emptyLabel }}</div></AppPopover></span></template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppInput from './AppInput.vue';
import AppPopover from './AppPopover.vue';
import type { SelectOption } from './AppSelect.vue';
const props = withDefaults(defineProps<{
    modelValue: string;
    options: SelectOption[];
    size?: 'sm' | 'md';
    small?: boolean;
    disabled?: boolean;
    placeholder?: string;
    label?: string;
    emptyLabel?: string;
    block?: boolean;
    allowCustom?: boolean;
}>(), { size: 'md', allowCustom: true, emptyLabel: 'Нет вариантов' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const root = ref<HTMLElement>(), input = ref<InstanceType<typeof AppInput>>(), open = ref(false), query = ref(''), typed = ref(false), active = ref(0);
const shown = computed(() => props.options.find(o => o.value === props.modelValue)?.label ?? props.modelValue);
const filtered = computed(() => props.options.filter(o => !typed.value || o.label.toLowerCase().includes(query.value.toLowerCase())));
function show() {
    if (props.disabled || open.value) return;
    open.value = true;
    query.value = shown.value;
    typed.value = false;
    active.value = Math.max(0, filtered.value.findIndex(item => !item.disabled));
    input.value?.select();
}
function pick(value: string) {
    open.value = false;
    typed.value = false;
    emit('update:modelValue', value);
}
function blur() {
    if (open.value && typed.value && props.allowCustom) pick(query.value);
    open.value = false;
}
function key(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open.value)
            show();
        else {
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            for (let i = 0; i < filtered.value.length; i++) {
                active.value = (active.value + direction + filtered.value.length) % filtered.value.length;
                if (!filtered.value[active.value].disabled) break;
            }
        }
    }
    if (event.key === 'Enter' && open.value) {
        event.preventDefault();
        const item = filtered.value[active.value];
        if (item) {
            if (!item.disabled) pick(item.value);
        } else if (props.allowCustom)
            pick(query.value);
    }
}
watch(() => props.disabled, value => { if (value)
    open.value = false; });
defineExpose({ focus: () => input.value?.focus() });
</script>
<style scoped>@import './styles/options.css'; .combobox { display: inline-flex; min-width: 0; } .combobox.block { display: flex; width: 100%; }</style>
