<template>
  <div ref="root" class="select" :class="[`select-${size}`, { open, disabled }]">
    <button
      type="button"
      class="select-trigger"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="select-value" :class="{ placeholder: !selected }">
        {{ selected ? selected.label : placeholder }}
      </span>
      <svg class="select-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Transition name="select-pop">
      <div v-if="open" class="select-menu">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="select-option"
          :class="{ active: opt.value === modelValue, disabled: opt.disabled }"
          :disabled="opt.disabled"
          @click="pick(opt)"
        >
          <span class="select-option-label">{{ opt.label }}</span>
          <svg v-if="opt.value === modelValue" class="select-check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

export interface SelectOption { value: string; label: string; disabled?: boolean }

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  size?: 'md' | 'sm'
  disabled?: boolean
}>(), {
  placeholder: 'Выбрать',
  size: 'md',
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)

const selected = computed(() => props.options.find(o => o.value === props.modelValue) ?? null)

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function pick(opt: SelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.select { position: relative; display: inline-flex; -webkit-app-region: no-drag; }

.select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: var(--size-md);
  padding: 0 10px 0 12px;
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-btn);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
}
.select-sm .select-trigger { height: var(--size-sm); font-size: 12px; padding: 0 8px 0 10px; }
.select-trigger:hover:not(:disabled) { border-color: var(--text-faint); }
.select.open .select-trigger { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.select-trigger:disabled { opacity: 0.5; cursor: not-allowed; }

.select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-value.placeholder { color: var(--text-faint); }

.select-chevron { width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0; transition: transform 0.15s; }
.select.open .select-chevron { transform: rotate(180deg); }

.select-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 100%;
  max-width: 320px;
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 60;
}

.select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.select-option-label { overflow: hidden; text-overflow: ellipsis; }
.select-option:hover:not(:disabled) { background: var(--bg3); }
.select-option.active { color: var(--blue-hover); font-weight: 600; }
.select-option.disabled { color: var(--text-faint); cursor: default; }
.select-check { width: 15px; height: 15px; color: var(--blue-hover); flex-shrink: 0; }

.select-pop-enter-active, .select-pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.select-pop-enter-from, .select-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
