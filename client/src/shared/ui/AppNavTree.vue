<template>
  <nav class="nav-tree" :aria-label="label">
    <template v-for="item in items" :key="item.id">
      <AppTreeRow v-if="!item.children" class="app-no-drag" :name="item.label" :active="modelValue === item.page" @click="emit('update:modelValue', item.page!)" />
      <template v-else>
        <AppTreeRow class="app-no-drag" toggle-end :name="item.label" :expanded="isOpen(item.id)" :active="!isOpen(item.id) && sectionOf(modelValue) === item.id" @click="clickSection(item)" @toggle="toggle(item.id)" />
        <template v-if="isOpen(item.id)">
          <AppTreeRow v-for="child in item.children" :key="child.page" class="app-no-drag" :name="child.label" nested :active="modelValue === child.page" @click="emit('update:modelValue', child.page)" />
        </template>
      </template>
    </template>
  </nav>
</template>

<script lang="ts">
/** A page of the navigation, or a section that folds its pages. */
export interface NavTreeItem { id: string; label: string; page?: string; children?: { page: string; label: string }[] }
/** What a page header shows for a page: its section name as the parent, when the page sits inside one. */
export function navTreePage(items: NavTreeItem[], page: string): { parent?: string; title: string } {
  for (const item of items) {
    if (item.page === page) return { title: item.label }
    const child = item.children?.find(c => c.page === page)
    if (child) return { parent: item.label, title: child.label }
  }
  return { title: '' }
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AppTreeRow from './AppTreeRow.vue'

/** The left navigation of a settings-like screen: pages, and sections that expand into their pages. */
const props = defineProps<{ modelValue: string; items: NavTreeItem[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [page: string] }>()

const sectionOf = (page: string) => props.items.find(item => item.children?.some(child => child.page === page))?.id

// The section holding the open page stays expanded, also when the page is opened from elsewhere.
const open = ref(new Set<string>([sectionOf(props.modelValue)].filter((id): id is string => !!id)))
watch(() => props.modelValue, page => { const id = sectionOf(page); if (id) open.value = new Set(open.value).add(id) })

const isOpen = (id: string) => open.value.has(id)
function toggle(id: string) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
// A closed section opens on its first page; an open one folds up.
function clickSection(item: NavTreeItem) {
  if (isOpen(item.id)) return toggle(item.id)
  toggle(item.id)
  if (sectionOf(props.modelValue) !== item.id) emit('update:modelValue', item.children![0].page)
}
</script>

<style scoped>
.nav-tree { display: flex; flex-direction: column; gap: var(--sp-1); }
</style>
