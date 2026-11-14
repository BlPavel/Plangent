<template>
  <AppCard role="alert" tone="warning" padding="sm" class="stale-draft-note">
    <span>Документ изменился. Ваши правки сохранены.</span>
    <AppButton size="xs" variant="ghost" @click="$emit('reload')">Взять актуальный</AppButton>
  </AppCard>
</template>
<script setup lang="ts">
import AppCard from './AppCard.vue';
import AppButton from './AppButton.vue';
defineEmits<{
    reload: [
    ];
}>();
</script>
<style scoped>
.stale-draft-note { display: flex; align-items: center; gap: var(--sp-2); }
</style>
