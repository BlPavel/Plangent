<template>
  <!-- An empty preparation stage (Архитектура, QA, План): one centered card with what it is and how to start. -->
  <div class="stage-empty">
    <div class="stage-empty-card">
      <div class="stage-empty-title">{{ title }}</div>
      <slot />
      <div v-if="$slots.actions" class="stage-empty-actions"><slot name="actions" /></div>
    </div>
  </div>
</template>
<script setup lang="ts">
defineProps<{ title: string }>()
</script>
<style scoped>
.stage-empty { flex: 1; min-height: 0; overflow-y: auto; display: flex; align-items: center; justify-content: center; padding: 24px 20px; }
.stage-empty-card { display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(560px, 100%); padding: 28px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; font-size: var(--fs-md); line-height: 1.5; color: var(--text-muted); }
.stage-empty-card :slotted(p) { margin: 0; }
.stage-empty-title { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.stage-empty-actions { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
</style>
