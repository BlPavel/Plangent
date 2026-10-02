<template>
  <div class="availability">
    <label class="caption">{{ label }}</label>
    <div v-if="!within || allowEverywhere" class="modes">
      <label class="mode"><input type="radio" :checked="modelValue.everywhere" @change="set({ everywhere: true })" /> Везде</label>
      <label class="mode"><input type="radio" :checked="!modelValue.everywhere" @change="set({ everywhere: false })" /> Выбранным</label>
    </div>
    <template v-if="(within && !allowEverywhere) || !modelValue.everywhere">
      <div v-if="ownFolder && options.length > 1" class="bulk">
        <button type="button" class="bulk-btn" @click="selectAll">Выбрать все</button>
        <button type="button" class="bulk-btn" :disabled="!selected.size" @click="commit(new Set())">Снять выбор</button>
      </div>
      <div class="targets">
        <label v-for="o in options" :key="o.id" class="target">
          <input type="checkbox" :checked="isChecked(o.id)" @change="toggle(o.id)" />
          <span>{{ o.kind === 'group' ? '🗂' : '📁' }} {{ o.name }}</span>
          <span v-if="o.kind === 'group'" class="hint">{{ ownFolder ? 'папка группы' : 'со всеми проектами' }}</span>
          <span v-else-if="o.group_id" class="hint">{{ projectsStore.byId(o.group_id)?.name }}</span>
        </label>
        <span v-if="!options.length" class="hint">Пока нет проектов и групп.</span>
      </div>
    </template>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useProjectsStore } from '../stores/projects'

/** «Доступно для»: everywhere, or chosen groups/projects (a group covers all its projects, also future ones). */
export interface Availability { everywhere: boolean; targets: string[]; /** groups that give it to their own folder only */ ownOnly?: string[] }

// `allowEverywhere` keeps the «Везде» choice next to a `within` neighbourhood.
const props = withDefaults(defineProps<{ modelValue: Availability; label?: string; hint?: string; within?: string; ownFolder?: boolean; allowEverywhere?: boolean }>(), { label: 'Доступно', hint: '' })
const emit = defineEmits<{ 'update:modelValue': [value: Availability] }>()
const projectsStore = useProjectsStore()

// `within` pins the choice to one project's neighbourhood: its group (or itself) and the group's projects.
const options = computed(() => {
  const scope = props.within ? projectsStore.byId(props.within) : null
  if (!scope) return [...projectsStore.groups, ...projectsStore.workProjects]
  const group = scope.kind === 'group' ? scope : scope.group_id ? projectsStore.byId(scope.group_id) : null
  return group ? [group, ...projectsStore.members(group.id)] : [scope]
})

// With `ownFolder` a group is its own folder and every project is a separate box. A group stored with all of
// its projects (the usual «вся группа») also covers projects added later; anything less is an explicit list.
const selected = computed(() => {
  const sel = new Set<string>()
  const { targets, ownOnly = [] } = props.modelValue
  for (const id of targets) {
    sel.add(id)
    if (props.ownFolder && !ownOnly.includes(id)) for (const m of projectsStore.members(id)) sel.add(m.id)
  }
  return sel
})
const isChecked = (id: string) => props.ownFolder ? selected.value.has(id) : props.modelValue.targets.includes(id)

function commit(sel: Set<string>) {
  const targets: string[] = []
  const ownOnly: string[] = []
  const covered = new Set<string>()
  for (const g of options.value.filter(o => o.kind === 'group' && sel.has(o.id))) {
    targets.push(g.id)
    const members = projectsStore.members(g.id)
    if (members.length && members.every(m => sel.has(m.id))) covered.add(g.id)
    else ownOnly.push(g.id)
  }
  for (const p of options.value.filter(o => o.kind !== 'group' && sel.has(o.id))) if (!p.group_id || !covered.has(p.group_id)) targets.push(p.id)
  set({ targets, ownOnly })
}

function toggle(id: string) {
  if (!props.ownFolder) {
    const { targets } = props.modelValue
    return set({ targets: targets.includes(id) ? targets.filter(t => t !== id) : [...targets, id] })
  }
  const sel = new Set(selected.value)
  if (!sel.delete(id)) sel.add(id)
  commit(sel)
}
const selectAll = () => commit(new Set(options.value.map(o => o.id)))

function set(patch: Partial<Availability>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>

<style scoped>
.availability { display: flex; flex-direction: column; gap: 6px; }
.caption { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.modes { display: flex; gap: 16px; font-size: 13px; }
.mode { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.targets {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
  padding: 6px 8px;
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.target { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; cursor: pointer; }
.bulk { display: flex; gap: 12px; }
.bulk-btn { padding: 0; background: none; border: none; font: inherit; font-size: 12px; color: var(--blue-hover); cursor: pointer; }
.bulk-btn:hover:not(:disabled) { text-decoration: underline; }
.bulk-btn:disabled { color: var(--text-faint); cursor: default; }
.hint { font-size: 11px; color: var(--text-faint); }
</style>
