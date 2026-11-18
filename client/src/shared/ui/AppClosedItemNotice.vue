<template>
  <div v-if="notice" class="closed-notice" role="status">
    <span>{{ label }}</span>
    <AppButton variant="link" size="xs" type="button" @click="emit('reveal')">Показать</AppButton>
  </div>
  <slot v-else />
</template>
<script setup lang="ts">
import AppButton from './AppButton.vue'
withDefaults(defineProps<{ notice: boolean; label?: string }>(), { label: 'Замечание закрыто' })
const emit = defineEmits<{ reveal: [] }>()
</script>
<style scoped>
.closed-notice { display: flex; align-items: center; gap: var(--sp-2); color: var(--text-muted); font-size: var(--fs-sm); }
</style>
