<template>
  <AppButton block variant="ghost" :pressed="live" :title="'Открыть замечания раунда ' + round" @click="$emit('open')">
    <span>🤖 Ревью агентом · {{ auto ? 'авто · ' : '' }}раунд {{ round }}</span>
    <span class="round-state">{{ live ? 'идёт…' : 'готово' }}</span>
    <span class="round-go">→ «Проверка»</span>
  </AppButton>
</template>
<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
defineProps<{ round: number; live: boolean; auto?: boolean }>()
defineEmits<{ open: [] }>()
</script>
<style scoped>
.round-state { color: var(--text-muted); }
.round-go { margin-left: auto; color: var(--blue-hover); }
</style>
