<template>
  <div class="form-field">
    <label v-if="label">{{ label }}</label>
    <textarea
      v-if="type === 'textarea'"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows ?? 3"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <select
      v-else-if="type === 'select'"
      :value="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <input
      v-else
      :type="type ?? 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string
  label?: string
  placeholder?: string
  type?: string
  rows?: number
  hint?: string
}>()
defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<style scoped>
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
input, textarea, select {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.1s;
}
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--blue); }
textarea { resize: vertical; min-height: 64px; }
.hint { font-size: 11px; color: var(--text-muted); }
</style>
