<template>
  <div ref="root" class="select" :class="[`select-${size}`, `select-${placement}`, `select-${variant}`, { open, disabled }]">
    <button
      type="button"
      class="select-trigger"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="select-value" :class="{ placeholder: !selected }">
        <span v-if="prefix" class="select-prefix">{{ prefix }}</span>{{ selected ? selected.label : placeholder }}
      </span>
      <svg class="select-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Teleported and fixed so narrow or scrolling containers (side panels, modals) never clip it. -->
    <Teleport to="body">
      <Transition :name="above ? 'select-pop-up' : 'select-pop'">
        <div v-if="open" ref="menu" class="select-menu" :class="{ 'select-menu-rich': rich }" :style="pos">
          <div v-if="heading" class="select-heading">{{ heading }}</div>
          <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="select-option"
            :class="{ active: opt.value === modelValue, disabled: opt.disabled }"
            :disabled="opt.disabled"
            @click="pick(opt)"
          >
            <span class="select-option-text">
              <span class="select-option-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="select-option-desc">{{ opt.description }}</span>
            </span>
            <svg v-if="opt.value === modelValue" class="select-check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, type CSSProperties } from 'vue'

export interface SelectOption { value: string; label: string; description?: string; disabled?: boolean }

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  size?: 'md' | 'sm'
  disabled?: boolean
  /** muted text before the value, e.g. "Модель" */
  prefix?: string
  /** small caption at the top of the open menu explaining what the choice means */
  heading?: string
  /** subtle: no fill or border until hover, for dense toolbars */
  variant?: 'default' | 'subtle'
  /** which side of the trigger the menu opens on */
  placement?: 'bottom' | 'top'
}>(), {
  placeholder: 'Выбрать',
  size: 'md',
  disabled: false,
  placement: 'bottom',
  variant: 'default',
  prefix: '',
  heading: '',
})

const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const above = ref(false)
const pos = ref<CSSProperties>({})

const rich = computed(() => !!props.heading || props.options.some(o => o.description))
const selected = computed(() => props.options.find(o => o.value === props.modelValue) ?? null)

const GAP = 6, EDGE = 8
/** Opens on the preferred side unless the other one has clearly more room; never leaves the window. */
function place() {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const over = r.top - GAP - EDGE
  const wanted = rich.value ? 360 : 280
  above.value = props.placement === 'top' ? over >= Math.min(wanted, below) : below < Math.min(wanted, 160) && over > below
  pos.value = {
    left: `${clampLeft(r.left, rich.value ? 300 : r.width)}px`,
    minWidth: `${r.width}px`,
    maxHeight: `${Math.max(120, Math.min(wanted, above.value ? over : below))}px`,
    ...(above.value ? { bottom: `${window.innerHeight - r.top + GAP}px` } : { top: `${r.bottom + GAP}px` }),
  }
}
const clampLeft = (left: number, width: number) => Math.max(EDGE, Math.min(left, document.documentElement.clientWidth - EDGE - width))
async function toggle() {
  if (props.disabled) return
  if (open.value) { open.value = false; return }
  place()
  open.value = true
  // The real width is known only once rendered: shift the menu left so it stays inside the window.
  await nextTick()
  if (!open.value || !menu.value || !root.value) return
  pos.value = { ...pos.value, left: `${clampLeft(root.value.getBoundingClientRect().left, menu.value.offsetWidth)}px` }
}
/** A scrolled or resized page moves the trigger; a fixed menu would stay behind, so it closes. */
function onMove(e: Event) {
  if (open.value && !(e.target instanceof Node && menu.value?.contains(e.target))) open.value = false
}

function pick(opt: SelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  open.value = false
}

function onDocClick(e: MouseEvent) {
  const target = e.target as Node
  if (root.value && !root.value.contains(target) && !menu.value?.contains(target)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onMove, true)
  window.addEventListener('resize', onMove)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', onMove, true)
  window.removeEventListener('resize', onMove)
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
  position: fixed;
  max-width: 320px;
  overflow-y: auto;
  padding: 5px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 1100; /* above anything a select can sit in: modals, dialogs, the folder picker */
}

.select-subtle .select-trigger { background: transparent; border-color: transparent; max-width: 220px; color: var(--text-muted); }
.select-subtle .select-trigger:hover:not(:disabled) { background: var(--bg3); border-color: transparent; color: var(--text); }
.select-subtle.open .select-trigger { background: var(--bg3); border-color: var(--border-strong); box-shadow: none; color: var(--text); }


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
.select-option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.select-option-label { overflow: hidden; text-overflow: ellipsis; }
.select-option-desc { font-size: 11.5px; font-weight: 400; color: var(--text-faint); white-space: normal; line-height: 1.35; }
.select-option.active .select-option-desc { color: var(--text-muted); }
.select-menu-rich { width: 300px; max-width: calc(100vw - 16px); }
.select-menu-rich .select-option { white-space: normal; align-items: flex-start; }
.select-menu-rich .select-check { margin-top: 2px; }
.select-heading { padding: 6px 10px 8px; font-size: 11.5px; line-height: 1.4; color: var(--text-muted); border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.select-prefix { color: var(--text-faint); margin-right: 5px; }
.select-option:hover:not(:disabled) { background: var(--bg3); }
.select-option.active { color: var(--blue-hover); font-weight: 600; }
.select-option.disabled { color: var(--text-faint); cursor: default; }
.select-check { width: 15px; height: 15px; color: var(--blue-hover); flex-shrink: 0; }

.select-pop-enter-active, .select-pop-leave-active, .select-pop-up-enter-active, .select-pop-up-leave-active { transition: opacity 0.12s, transform 0.12s; }
.select-pop-enter-from, .select-pop-leave-to { opacity: 0; transform: translateY(-4px); }
.select-pop-up-enter-from, .select-pop-up-leave-to { opacity: 0; transform: translateY(4px); }
</style>
