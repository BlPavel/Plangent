<template>
  <span ref="root" class="select" :class="{ block }">
    <AppButton :variant="variant === 'subtle' ? 'subtle' : 'ghost'" :size="small ? 'sm' : size" :disabled="disabled" :block="block" :pressed="open" aria-haspopup="listbox" :aria-expanded="open" :id="id" :aria-label="label || undefined" @click="open = !open" @keydown.down.prevent="open = true" @keydown.up.prevent="open = true">
      <span class="value"><span v-if="prefix" class="prefix">{{ prefix }}</span>{{ selected?.label ?? placeholder }}</span><IconChevron class="chevron" />
    </AppButton>
    <AppPopover focus-on-open v-model="open" :anchor="root" :placement="placement" :max-width="popupMaxWidth" role="listbox">
      <div v-if="heading" class="heading">{{ heading }}</div>
      <button v-for="option in options" :key="option.value" type="button" role="option" class="option" :class="{ selected: option.value === modelValue }" :disabled="option.disabled" :aria-selected="option.value === modelValue" @click="pick(option.value)"><span>{{ option.label }}<span v-if="option.description" class="description">{{ option.description }}</span></span><IconCheck v-if="option.value === modelValue" class="chevron" /></button>
      <div v-if="!options.length" class="heading">{{ emptyLabel }}</div>
    </AppPopover>
  </span>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppButton from './AppButton.vue';
import AppPopover from './AppPopover.vue';
import { IconChevron, IconCheck } from './icons';
export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
}
const props = withDefaults(defineProps<{
    id?: string;
    modelValue: string;
    options: SelectOption[];
    placeholder?: string;
    size?: 'xs' | 'sm' | 'md';
    small?: boolean;
    disabled?: boolean;
    prefix?: string;
    heading?: string;
    variant?: 'default' | 'subtle';
    placement?: 'top' | 'bottom';
    block?: boolean;
    label?: string;
    emptyLabel?: string;
    popupMaxWidth?: number;
}>(), { size: 'md', placeholder: 'Выбрать', emptyLabel: 'Нет вариантов' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
}>();
const root = ref<HTMLElement>(), open = ref(false);
const selected = computed(() => props.options.find(option => option.value === props.modelValue));
function pick(value: string) { open.value = false; emit('update:modelValue', value); root.value?.querySelector('button')?.focus(); }
watch(() => props.disabled, value => { if (value)
    open.value = false; });
</script>
<style scoped>
@import './styles/options.css';
.select { display: inline-flex; min-width: 0; }
.select.block { display: flex; width: 100%; }
.value { line-height: var(--lh-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prefix { margin-right: var(--sp-1); }
.chevron { width: 14px; height: 14px; flex-shrink: 0; margin-left: auto; }
</style>
