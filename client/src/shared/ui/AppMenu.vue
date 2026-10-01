<template>
  <div ref="root" class="menu" :class="{ open }">
    <button
      type="button"
      class="btn btn-subtle btn-icon"
      :class="size === 'md' ? '' : `btn-${size}`"
      :title="title"
      :aria-label="title"
      @click.stop="toggle"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
    </button>
    <!-- Teleported and fixed so scrolling containers (sidebar, modals) never clip it. -->
    <Teleport to="body">
    <Transition name="menu-pop">
      <div v-if="open" ref="list" class="menu-list" :style="pos" @click.stop>
        <template v-for="(item, i) in items" :key="i">
          <div v-if="item.separator" class="menu-sep" />
          <div v-else-if="item.heading" class="menu-heading">{{ item.heading }}</div>
          <button
            v-else
            type="button"
            class="menu-item"
            :class="{ danger: item.danger }"
            :disabled="item.disabled"
            @click="pick(item)"
          >
            <span class="menu-label">{{ item.label }}</span>
            <span v-if="item.hint" class="menu-hint">{{ item.hint }}</span>
          </button>
        </template>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, type CSSProperties } from 'vue'

/** A "⋯" button with a list of secondary actions. */
export interface MenuItem {
  label?: string; hint?: string; danger?: boolean; disabled?: boolean
  /** a thin line between groups */
  separator?: boolean
  /** a small caption above a group of items */
  heading?: string
  action?: () => void
}

const props = withDefaults(defineProps<{
  items: MenuItem[]
  title?: string
  size?: 'md' | 'sm' | 'xs'
  align?: 'left' | 'right'
}>(), { title: 'Ещё', size: 'sm', align: 'right' })

const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const pos = ref<CSSProperties>({})

function toggle() {
  if (!open.value && root.value) {
    const r = root.value.getBoundingClientRect()
    const room = window.innerHeight - r.bottom - 14
    const above = room < 160 && r.top > room
    pos.value = {
      ...(props.align === 'right' ? { right: `${window.innerWidth - r.right}px` } : { left: `${r.left}px` }),
      ...(above ? { bottom: `${window.innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` }),
      maxHeight: `${Math.min(360, above ? r.top - 14 : room)}px`,
    }
  }
  open.value = !open.value
}

function pick(item: MenuItem) {
  open.value = false
  item.action?.()
}
function onDocClick(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node) && !list.value?.contains(e.target as Node)) open.value = false
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
.menu { position: relative; display: inline-flex; -webkit-app-region: no-drag; }
.menu svg { width: 14px; height: 14px; }
.menu.open > .btn { background: var(--bg3); color: var(--text); }
.menu-list {
  position: fixed;
  min-width: 220px;
  max-width: 300px;
  overflow-y: auto;
  padding: 5px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 200;
}
.menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
}
.menu-item:hover:not(:disabled) { background: var(--bg3); }
.menu-item:disabled { color: var(--text-faint); cursor: default; }
.menu-item.danger { color: var(--danger-hover); }
.menu-hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.35; white-space: normal; }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--border); }
.menu-heading { padding: 6px 10px 3px; font-size: 11px; font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.4px; }
.menu-pop-enter-active, .menu-pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.menu-pop-enter-from, .menu-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
