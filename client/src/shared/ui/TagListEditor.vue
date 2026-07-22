<template>
  <div class="tag-list-editor">
    <label v-if="label">{{ label }}</label>
    <div v-for="(item, i) in modelValue" :key="i" class="tag-row">
      <input
        :value="item"
        :placeholder="placeholder"
        @input="update(i, ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="tag-remove" title="Удалить" @click="remove(i)">
        <IconTrash />
      </button>
    </div>
    <button type="button" class="tag-add" @click="add">+ Добавить</button>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
import IconTrash from './IconTrash.vue'

const props = defineProps<{
  modelValue: string[]
  label?: string
  placeholder?: string
  hint?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()

function update(i: number, value: string) {
  const next = [...props.modelValue]
  next[i] = value
  emit('update:modelValue', next)
}
function add() {
  emit('update:modelValue', [...props.modelValue, ''])
}
function remove(i: number) {
  const next = [...props.modelValue]
  next.splice(i, 1)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.tag-list-editor { display: flex; flex-direction: column; gap: 6px; }
label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.tag-row { display: flex; gap: 6px; }
.tag-row input {
  flex: 1;
  min-width: 0;
  height: var(--size-md);
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 0 10px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.tag-row input:focus {
  outline: none;
  border-color: var(--blue);
  box-shadow: 0 0 0 3px var(--blue-soft);
}
.tag-remove {
  flex-shrink: 0;
  width: var(--size-md);
  height: var(--size-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.tag-remove:hover { color: var(--red, #e5534b); border-color: var(--red, #e5534b); }
.tag-remove svg { width: 14px; height: 14px; }
.tag-add {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--blue);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
}
.tag-add:hover { text-decoration: underline; }
.hint { font-size: 11px; color: var(--text-faint); }
</style>
