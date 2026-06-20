<template>
  <span class="status-badge" :class="badgeClass">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * Dumb, domain-agnostic status pill. Maps a task/plan status string to a
 * consistent label + colour so every screen shows the same badge.
 */
const props = defineProps<{ status?: string | null }>()

const MAP: Record<string, { label: string; cls: string }> = {
  open: { label: 'Открыта', cls: 'open' },
  in_progress: { label: 'В работе', cls: 'progress' },
  done: { label: 'Готово', cls: 'done' },
}

const entry = computed(() => (props.status ? MAP[props.status] : undefined))
const label = computed(() => entry.value?.label ?? props.status ?? '—')
const badgeClass = computed(() => entry.value?.cls ?? 'neutral')
</script>
