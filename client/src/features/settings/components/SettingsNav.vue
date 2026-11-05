<template>
  <nav class="settings-nav" aria-label="Настройки">
    <template v-for="item in SETTINGS_NAV" :key="item.id">
      <AppTreeRow v-if="!item.children" class="app-no-drag" :name="item.label" :active="modelValue === item.tab"  @click="emit('update:modelValue', item.tab!)" />
      <template v-else>
        <AppTreeRow class="app-no-drag" toggle-end :name="item.label" :expanded="isOpen(item.id)" :active="!isOpen(item.id) && sectionOf(modelValue) === item.id" @click="clickSection(item)" @toggle="toggle(item.id)" />
        <template v-if="isOpen(item.id)">
          <AppTreeRow v-for="child in item.children" :key="child.tab" class="app-no-drag" :name="child.label" nested :active="modelValue === child.tab" @click="emit('update:modelValue', child.tab)" />
        </template>
      </template>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { AppTreeRow } from '@shared/ui'
import { SETTINGS_NAV, sectionOf, type SettingsNavItem, type SettingsTab } from '../utils/nav'

const props = defineProps<{ modelValue: SettingsTab }>()
const emit = defineEmits<{ 'update:modelValue': [tab: SettingsTab] }>()

// The section holding the open page stays expanded, also when the page is opened from elsewhere.
const open = ref(new Set<string>([sectionOf(props.modelValue)].filter((id): id is string => !!id)))
watch(() => props.modelValue, tab => { const id = sectionOf(tab); if (id) open.value = new Set(open.value).add(id) })

const isOpen = (id: string) => open.value.has(id)
function toggle(id: string) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
// A closed section opens on its first page; an open one folds up.
function clickSection(item: SettingsNavItem) {
  if (isOpen(item.id)) return toggle(item.id)
  toggle(item.id)
  if (sectionOf(props.modelValue) !== item.id) emit('update:modelValue', item.children![0].tab)
}
</script>

<style scoped>
.settings-nav { display: flex; flex-direction: column; gap: var(--sp-1); }
</style>
