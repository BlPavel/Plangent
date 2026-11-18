<template>
  <div class="visibility">
    <AppCheckbox :model-value="modelValue" label="Показывать закрытые" @update:model-value="emit('update:modelValue', $event)" />
    <span v-if="!modelValue && hiddenCount" role="status">Скрыто закрытых: {{ hiddenCount }}</span>
  </div>
</template>
<script setup lang="ts">
import AppCheckbox from './AppCheckbox.vue'
withDefaults(defineProps<{ modelValue: boolean; hiddenCount?: number }>(), { hiddenCount: 0 })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
<style scoped>
.visibility { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.visibility > span { color: var(--text-muted); font-size: var(--fs-sm); }
</style>
