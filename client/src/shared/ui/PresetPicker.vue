<template>
  <div v-if="presets.length" class="preset-picker">
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
  </div>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue'

/** "Fill as:" row: ready-made settings copied into a form, each with what it suits. */
defineProps<{
  presets: { id: string; name: string; description: string }[]
  /** Id of the preset applied in this form, if any. */
  applied?: string
  note?: string
}>()
defineEmits<{ apply: [id: string] }>()
</script>

<style scoped>
.preset-picker { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); }
.presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.presets-label { font-size: 12px; color: var(--text-muted); }
.descriptions { list-style: none; display: flex; flex-direction: column; gap: 2px; }
.descriptions li, .note { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); }
.descriptions b { color: var(--text); font-weight: 600; }
.note { color: var(--text-faint); }
</style>
