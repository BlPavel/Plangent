<template>
  <span class="branch-name">
    <AppSelect
      v-if="prefixes.length" class="prefix" :model-value="prefix" :options="[{ value: '', label: 'без префикса' }, ...prefixes.map(item => ({ value: item, label: item + '/' }))]" small :disabled="disabled" label="Префикс ветки"
      @update:model-value="emit('update:modelValue', join($event, rest))"
    />
    <AppInput block size="sm" :model-value="rest" :placeholder="placeholder" :disabled="disabled" :aria-label="label" @update:model-value="emit('update:modelValue', join(prefix, $event))" @keydown.enter="emit('enter', $event)" />
  </span>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import AppInput from './AppInput.vue';
import AppSelect from './AppSelect.vue';
/** A branch name split into one of the project's prefixes (feature/, fix/ …) and the rest; the model is the full name. */
const props = withDefaults(defineProps<{
    modelValue: string;
    prefixes: string[];
    placeholder?: string;
    label?: string;
    disabled?: boolean;
}>(), { label: 'Имя ветки' });
const emit = defineEmits<{
    'update:modelValue': [
        value: string
    ];
    enter: [
        event: KeyboardEvent
    ];
}>();
const prefix = computed(() => props.prefixes.find(item => props.modelValue.startsWith(item + '/')) ?? '');
const rest = computed(() => prefix.value ? props.modelValue.slice(prefix.value.length + 1) : props.modelValue);
const join = (head: string, tail: string) => head ? head + '/' + tail : tail;
</script>
<style scoped>
.branch-name { display: flex; gap: 4px; min-width: 0; width: 100%; }
.prefix { flex: 0 0 auto; max-width: 45%; }

</style>
