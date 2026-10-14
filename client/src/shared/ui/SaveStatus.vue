<template>
  <span class="save-status" :class="state" role="status">{{ text }}</span>
</template>
<script lang="ts">
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved'
</script>
<script setup lang="ts">
import { computed } from 'vue'

/** Quiet line for forms that save as you edit. */
const props = defineProps<{ state: SaveState }>()
const text = computed(() => ({ idle: '', pending: 'Изменения сохранятся автоматически', saving: 'Сохранение…', saved: 'Сохранено' })[props.state])
</script>
<style scoped>
.save-status { min-height: 16px; font-size: 11.5px; color: var(--text-faint); }
.save-status.saved { color: var(--accent-hover); }
</style>
