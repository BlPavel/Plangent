<template>
  <div class="tree-row" :class="{ active, nested, 'has-toggle': expanded !== undefined && !toggleEnd, 'toggle-end': toggleEnd, 'no-icon': !icon }" :title="title" tabindex="0" :aria-current="active ? 'true' : undefined" @click="emit('click')" @keydown.enter.self.prevent="emit('click')" @keydown.space.self.prevent="emit('click')">
    <button v-if="expanded !== undefined" type="button" class="tree-row-toggle" tabindex="-1" :aria-label="expanded ? 'Свернуть' : 'Развернуть'" :aria-expanded="expanded" @click.stop="emit('toggle')">
      <IconChevronRight :class="{ expanded }" />
    </button>
    <span v-if="icon" class="tree-row-icon" aria-hidden="true">{{ icon }}</span>
    <span class="tree-row-name">{{ name }}</span>
    <AppCount v-if="count" :value="count" tone="warning" :title="countTitle" />
  </div>
</template>

<script setup lang="ts">
import AppCount from './AppCount.vue'
import { IconChevronRight } from './icons'
/** A sidebar list row: icon, name, an optional attention count on the right and an optional expand chevron. */
withDefaults(defineProps<{
  icon?: string
  name: string
  active?: boolean
  nested?: boolean
  count?: number
  countTitle?: string
  title?: string
  /** Set (true/false) to show the chevron; leave undefined for rows that cannot expand. */
  expanded?: boolean
  /** Chevron after the name, at the right edge, so names keep one left line. */
  toggleEnd?: boolean
}>(), { expanded: undefined })
const emit = defineEmits<{ click: []; toggle: [] }>()
</script>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 8px 0 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: background var(--motion-fast), color var(--motion-fast);
}
.tree-row.has-toggle { padding-left: 4px; }
.tree-row.nested { padding-left: 30px; }
.tree-row.nested.no-icon { padding-left: 24px; }
.tree-row.toggle-end .tree-row-toggle { order: 1; }
.tree-row:focus-visible { outline: var(--focus-outline); outline-offset: -2px; }
.tree-row:hover { background: var(--bg3); color: var(--text); }
.tree-row.active { background: var(--bg3); color: var(--text); box-shadow: inset 2px 0 0 var(--blue); }
.tree-row-icon { width: 18px; height: 18px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: var(--fs-md); line-height: 1; }
.tree-row-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tree-row-toggle { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-4); background: none; color: var(--text-muted); cursor: pointer; }
.tree-row-toggle:hover { background: var(--bg-hover); color: var(--text); }
.tree-row-toggle:focus-visible { outline: var(--focus-outline); }
.tree-row-toggle svg { width: 10px; height: 10px; transition: transform var(--motion-fast); }
.tree-row-toggle svg.expanded { transform: rotate(90deg); }
</style>
