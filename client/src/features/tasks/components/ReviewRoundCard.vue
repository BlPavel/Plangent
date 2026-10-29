<template>
  <button type="button" class="round-card" :class="{ live }" :title="'Открыть замечания раунда ' + round" @click="$emit('open')">
    <span>🤖 Ревью агентом · {{ auto ? 'авто · ' : '' }}раунд {{ round }}</span>
    <span class="round-state">{{ live ? 'идёт…' : 'готово' }}</span>
    <span class="round-go">→ «Проверка»</span>
  </button>
</template>
<script setup lang="ts">
defineProps<{ round: number; live: boolean; auto?: boolean }>()
defineEmits<{ open: [] }>()
</script>
<style scoped>
.round-card { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.round-card:hover { border-color: var(--border-strong); background: var(--bg3); }
.round-card.live { border-color: var(--blue-soft); }
.round-state { color: var(--text-muted); }
.round-go { margin-left: auto; color: var(--blue-hover); }
</style>
