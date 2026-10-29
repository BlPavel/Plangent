<template>
  <div ref="root" class="bsel" :class="{ open }">
    <input
      ref="input" class="control" :class="[small ? 'control-sm' : '', { plain }]" :value="open ? query : shown" :placeholder="placeholder" :disabled="disabled" :readonly="plain" :aria-label="label"
      role="combobox" :aria-expanded="open" autocomplete="off" spellcheck="false"
      @pointerdown="rearm" @focus="show" @click="show" @input="onInput" @keydown="rearm(); onKey($event)" @blur="close"
    />
    <svg class="bsel-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <!-- Clicks stop here: inside a <label> they would be forwarded to the input and reopen the list. -->
    <Teleport to="body">
      <div v-if="open" ref="list" class="bsel-list" role="listbox" :style="pos" @click.stop @pointerdown.stop>
        <button
          v-for="(item, index) in items" :key="item.value" type="button" class="bsel-item" :class="{ active: index === active, selected: item.value === modelValue }" role="option" :aria-selected="item.value === modelValue"
          @pointerdown.prevent @mousedown.prevent @click="pick(item)" @pointermove="active = index"
        >{{ item.label }}</button>
        <div v-if="!items.length" class="bsel-empty">Ничего не найдено</div>
      </div>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type CSSProperties } from 'vue'

type Option = { value: string; label: string }
/** A branch field you type into: the default stays shown, matching branches are offered below. */
const props = defineProps<{ modelValue: string; options: Option[]; placeholder?: string; label?: string; disabled?: boolean; small?: boolean; /** pick from the list only: no typing */ plain?: boolean; /** adds an entry that clears the value */ emptyLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>(), input = ref<HTMLInputElement>(), list = ref<HTMLElement>(), pos = ref<CSSProperties>({})
const open = ref(false), query = ref(''), typed = ref(false), active = ref(0)
const shown = computed(() => props.options.find(o => o.value === props.modelValue)?.label ?? props.modelValue)
const items = computed(() => {
  const text = typed.value ? query.value.trim().toLowerCase() : ''
  const found = props.options.filter(o => !text || o.label.toLowerCase().includes(text) || o.value.toLowerCase().includes(text))
  return props.emptyLabel !== undefined && !text ? [{ value: '', label: props.emptyLabel }, ...found] : found
})
const GAP = 4, EDGE = 8
/** The list is fixed to the window, not to the field: no container clips it or grows a scrollbar. It opens on the side with more room. */
function place() {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE
  const up = below < 160 && above > below
  const left = Math.max(EDGE, Math.min(r.left, document.documentElement.clientWidth - EDGE - r.width))
  pos.value = { left: left + 'px', width: r.width + 'px', maxHeight: Math.max(100, Math.min(260, up ? above : below)) + 'px', ...(up ? { bottom: window.innerHeight - r.top + GAP + 'px' } : { top: r.bottom + GAP + 'px' }) }
}
/** A scrolled or resized page moves the field; the fixed list would stay behind, so it closes. */
function onMove(event: Event) { if (open.value && !(event.target instanceof Node && list.value?.contains(event.target))) close() }
onMounted(() => { window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove) })
onBeforeUnmount(() => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove) })
/** Set by a pick: focus or clicks that follow it in the same gesture must not reopen the list. */
let closed = false
const rearm = () => { closed = false }
function show() {
  if (closed || open.value || props.disabled) return
  // The current value stays in the field (selected, so typing replaces it) and the whole list is offered until something is typed.
  place(); open.value = true; query.value = shown.value; typed.value = false
  const at = items.value.findIndex(o => o.value === props.modelValue)
  active.value = Math.max(at, 0)
  requestAnimationFrame(() => input.value?.select?.())
}
function close() { open.value = false }
function onInput(event: Event) { query.value = (event.target as HTMLInputElement).value; typed.value = true; active.value = 0 }
function pick(item: Option) {
  // Closed first: a consumer reacting to the new value must not be able to keep the list open.
  closed = true; close(); input.value?.blur()
  emit('update:modelValue', item.value)
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) { event.stopPropagation(); event.preventDefault(); close(); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) { show(); return }
    const count = items.value.length
    if (count) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    list.value?.querySelector('.bsel-item.active')?.scrollIntoView?.({ block: 'nearest' })
    return
  }
  if (event.key === 'Enter' && open.value) {
    event.preventDefault(); event.stopPropagation()
    const item = items.value[active.value]
    if (item) pick(item)
  }
}
</script>
<style scoped>
.bsel { position: relative; min-width: 0; flex: 1; }
.bsel input { width: 100%; padding-right: 30px; }
.bsel-chevron { position: absolute; right: 10px; top: 50%; width: 14px; height: 14px; margin-top: -7px; color: var(--text-muted); pointer-events: none; transition: transform .12s; }
.bsel.open .bsel-chevron { transform: rotate(180deg); }
.bsel input.plain { cursor: pointer; caret-color: transparent; }
.bsel-list { position: fixed; z-index: 1100; overflow-y: auto; font-size: 12px; display: flex; flex-direction: column; padding: 3px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-md); }
.bsel-item { padding: 4px 8px; font: inherit; font-size: 12px; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; overflow-wrap: anywhere; }
.bsel-item.active { background: var(--bg-hover); }
.bsel-item.selected { font-weight: 600; }
.bsel-empty { padding: 6px 8px; font-size: 12px; color: var(--text-faint); }
</style>
