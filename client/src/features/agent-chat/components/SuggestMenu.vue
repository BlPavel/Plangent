<template>
  <Teleport to="body" :disabled="!anchor">
    <div ref="menu" class="suggest" :class="{ 'suggest-floating': anchor }" :style="anchor ? position : undefined" @mousedown.prevent>
      <div class="suggest-head">
        <span>{{ title }}</span>
        <span class="suggest-keys"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Tab</kbd> вставить · <kbd>Enter</kbd> открыть папку · <kbd>Esc</kbd></span>
      </div>
      <div ref="list" class="suggest-list">
        <div v-if="!items.length" class="suggest-empty">{{ loading ? 'Поиск…' : empty }}</div>
        <template v-for="(item, index) in items" :key="item.value">
          <div v-if="item.section && item.section !== items[index - 1]?.section" class="suggest-section">{{ SECTIONS[item.section] }}</div>
          <button
            type="button"
            class="suggest-item"
            :class="{ active: index === active }"
            @mouseenter="$emit('hover', index)"
            @click="$emit('pick', item)"
          >
            <svg class="suggest-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path :d="item.ref && !item.prefix ? BOOK : item.dir ? FOLDER : item.command ? SLASH : FILE" /></svg>
            <span class="suggest-label"><bdi><span v-if="item.prefix" class="suggest-prefix">{{ item.prefix }}</span>{{ item.label }}</bdi></span>
            <span v-if="item.detail" class="suggest-detail">{{ item.detail }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type CSSProperties } from 'vue'
import { suggestPosition } from '../utils/suggest-position'

export interface SuggestItem { value: string; label: string; prefix?: string; detail?: string; dir?: boolean; command?: boolean; ref?: boolean; section?: 'members' | 'sources' | 'projects' }

const props = defineProps<{ title: string; items: SuggestItem[]; active: number; loading?: boolean; empty?: string; anchor?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [item: SuggestItem]; hover: [index: number]; dismiss: [] }>()
const list = ref<HTMLElement>()
const menu = shallowRef<HTMLElement>()
const position = ref<CSSProperties>({ visibility: 'hidden' })
let observer: ResizeObserver | undefined
function place() {
  if (!props.anchor) return
  position.value = suggestPosition(props.anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
}
function onMove(event: Event) {
  if (!props.anchor || (event.target instanceof Node && menu.value?.contains(event.target))) return
  const rect = props.anchor.getBoundingClientRect()
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) emit('dismiss')
  else place()
}
function onOutside(event: Event) {
  const target = event.target as Node
  if (props.anchor && !props.anchor.contains(target) && !menu.value?.contains(target)) emit('dismiss')
}
watch(() => props.anchor, anchor => {
  observer?.disconnect()
  if (anchor) observer?.observe(anchor)
  place()
}, { flush: 'post' })
onMounted(() => {
  place()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(place)
    if (props.anchor) observer.observe(props.anchor)
  }
  window.addEventListener('resize', onMove)
  window.addEventListener('scroll', onMove, true)
  document.addEventListener('pointerdown', onOutside)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', onMove)
  window.removeEventListener('scroll', onMove, true)
  document.removeEventListener('pointerdown', onOutside)
})

watch(() => props.active, async () => {
  await nextTick()
  list.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
})

const SECTIONS = { members: 'Проекты группы', sources: 'Справочные материалы', projects: 'Другие проекты' }
const FILE = 'M4 2.5h5l3 3v8H4z M9 2.5v3h3'
const FOLDER = 'M2.5 4.5v8h11v-6.5H8L6.5 4.5z'
const SLASH = 'M10 3L6 13'
const BOOK = 'M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 0 7 12H3z M13 3.5H9.5A1.5 1.5 0 0 0 8 5v8.5A1.5 1.5 0 0 1 9.5 12H13z'
</script>

<style scoped>
.suggest {
  position: absolute;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  z-index: 40;
}
.suggest-floating { z-index: 1100; }
.suggest-floating .suggest-list { min-height: 0; max-height: none; }
.suggest-head {
  flex-shrink: 0;
  flex-wrap: wrap;
  display: flex;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.suggest-keys { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--text-faint); white-space: normal; line-height: 1.7; }
kbd { font-family: inherit; font-size: 10px; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg3); color: var(--text-muted); }
.suggest-list { max-height: 264px; overflow-y: auto; padding: 4px; }
.suggest-section { padding: 8px 8px 4px; margin-top: 2px; border-top: 1px solid var(--border); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.suggest-section:first-child { border-top: none; margin-top: 0; }
.suggest-empty { padding: 10px 8px; font-size: 12px; color: var(--text-faint); }
.suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.suggest-item.active { background: var(--blue-soft); color: var(--blue-hover); }
.suggest-icon { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-faint); }
.suggest-item.active .suggest-icon { color: var(--blue-hover); }
.suggest-label { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.suggest-prefix { color: var(--text-muted); }
.suggest-item.active .suggest-prefix { color: var(--blue-hover); opacity: 0.75; }
.suggest-detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: var(--text-faint); }
</style>
