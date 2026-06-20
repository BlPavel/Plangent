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
.form-field { display: flex; flex-direction: column; gap: 6px; }
label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
input, textarea, select {
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.12s, box-shadow 0.12s;
}
input, select { height: var(--size-md); padding-top: 0; padding-bottom: 0; }
input::placeholder, textarea::placeholder { color: var(--text-faint); }
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--blue);
  box-shadow: 0 0 0 3px var(--blue-soft);
}
select {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 34px;
  /* Custom chevron so the native OS arrow doesn't clash with the theme */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%238b949e' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}
textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
.hint { font-size: 11px; color: var(--text-faint); }
</style>
