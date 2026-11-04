<template>
  <AppCard v-if="presets.length" padding="sm" class="preset-picker">
    <div class="presets">
      <span class="presets-label">Заполнить как:</span>
      <AppButton
        v-for="p in presets" :key="p.id" type="button" size="sm"
        :variant="p.id === applied ? 'blue' : 'ghost'" :title="p.description"
        @click="$emit('apply', p.id)"
      >{{ p.name }}</AppButton>
    </div>
    <!-- The description says what a preset suits before it is chosen, so all are shown until one is. -->
    <ul class="descriptions">
      <li v-for="p in presets.filter(p => !applied || p.id === applied)" :key="p.id"><b>{{ p.name }}</b> — {{ p.description }}</li>
    </ul>
    <p v-if="note" class="note">{{ note }}</p>
  </AppCard>
</template>

<script setup lang="ts">
import AppCard from './AppCard.vue';
import AppButton from './AppButton.vue';
/** "Fill as:" row: ready-made settings copied into a form, each with what it suits. */
defineProps<{
    presets: {
        id: string;
        name: string;
        description: string;
    }[];
    /** Id of the preset applied in this form, if any. */
    applied?: string;
    note?: string;
}>();
defineEmits<{
    apply: [
        id: string
    ];
}>();
</script>

<style scoped>
.preset-picker { display: flex; flex-direction: column; gap: var(--sp-1); }
.presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.presets-label { font-size: var(--fs-sm); color: var(--text-muted); }
.descriptions { list-style: none; display: flex; flex-direction: column; gap: 2px; }
.descriptions li, .note { font-size: var(--fs-sm); line-height: var(--lh-normal); color: var(--text-muted); }
.descriptions b { color: var(--text); font-weight: var(--fw-semibold); }
.note { color: var(--text-faint); }
</style>
