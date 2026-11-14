<template>
  <div class="tag-list-editor">
    <label v-if="label">{{ label }}</label>
    <div v-for="(item, i) in modelValue" :key="i" class="tag-row">
      <AppInput
        :model-value="item"
        :placeholder="placeholder"
        @update:model-value="update(i, $event)"
      />
      <AppButton variant="danger-link" icon title="Удалить" @click="remove(i)">
        <IconTrash />
      </AppButton>
    </div>
    <AppButton variant="link" @click="add">+ Добавить</AppButton>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
import AppInput from './AppInput.vue'
import AppButton from './AppButton.vue'
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

<style scoped>.tag-list-editor{display:flex;flex-direction:column;gap:var(--sp-1)}.tag-row{display:flex;gap:var(--sp-1)}label{color:var(--text-muted);font-size:var(--fs-sm)}.hint{color:var(--text-faint);font-size:var(--fs-xs)}</style>
