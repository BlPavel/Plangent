<template>
  <BranchSelect plain :model-value="modelValue" :options="options" :small="small" :placeholder="placeholder" :label="label" :disabled="disabled" :empty-label="emptyLabel" @update:model-value="emit('update:modelValue', $event)" />
</template>
<script setup lang="ts">
import BranchSelect from './BranchSelect.vue'

/** A select that opens the same dropdown as the branch field, but only picks from the list. */
defineProps<{ modelValue: string; options: { value: string; label: string }[]; placeholder?: string; label?: string; disabled?: boolean; small?: boolean; emptyLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
