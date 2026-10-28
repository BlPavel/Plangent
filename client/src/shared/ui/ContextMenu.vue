<template>
  <Teleport to="body">
    <Transition name="menu-pop">
      <div v-if="at" ref="list" class="cm-list" :style="pos" role="menu" @contextmenu.prevent @click.stop>
        <template v-for="(item, i) in items" :key="i">
          <div v-if="item.separator" class="cm-sep" />
          <div v-else-if="item.heading" class="cm-heading">{{ item.heading }}</div>
          <button v-else type="button" role="menuitem" class="cm-item" :class="{ danger: item.danger }" :disabled="item.disabled" @click="pick(item)">
            <span class="cm-label">{{ item.label }}</span>
            <span v-if="item.hint" class="cm-hint">{{ item.hint }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import type { MenuItem } from './AppMenu.vue'

/** A right-click menu at the cursor; `at` is set by the owner on `contextmenu` and cleared on `close`. */
const props = defineProps<{ items: MenuItem[]; at: { x: number; y: number } | null }>()
const emit = defineEmits<{ close: [] }>()

const list = ref<HTMLElement | null>(null)
const pos = ref<CSSProperties>({})

watch(() => props.at, async at => {
  if (!at) return
  pos.value = { left: `${at.x}px`, top: `${at.y}px` }
  await nextTick()
  const box = list.value?.getBoundingClientRect()
  if (!box) return
  // Keep the menu inside the window: flip it over the cursor when it would overflow.
  pos.value = {
    left: `${Math.max(6, Math.min(at.x, window.innerWidth - box.width - 6))}px`,
    top: `${Math.max(6, Math.min(at.y, window.innerHeight - box.height - 6))}px`,
  }
})

function pick(item: MenuItem) {
  emit('close')
  item.action?.()
}
function onDown(e: MouseEvent) {
  if (props.at && !list.value?.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent) {
  if (props.at && e.key === 'Escape') emit('close')
}
const onBlur = () => emit('close')
onMounted(() => {
  document.addEventListener('mousedown', onDown)
  document.addEventListener('keydown', onKey)
  window.addEventListener('blur', onBlur)
})
onUnmounted(() => {
  window.removeEventListener('blur', onBlur)
  document.removeEventListener('mousedown', onDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.cm-list {
  position: fixed;
  min-width: 200px;
  max-width: 300px;
  padding: 5px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 200;
}
.cm-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 4px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.cm-item:hover:not(:disabled) { background: var(--bg3); }
.cm-item:disabled { color: var(--text-faint); cursor: default; }
.cm-item.danger { color: var(--danger-hover); }
.cm-hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.35; white-space: normal; }
.cm-sep { height: 1px; margin: 4px 2px; background: var(--border); }
.cm-heading { padding: 6px 10px 3px; font-size: 11px; font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.4px; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; }
</style>
