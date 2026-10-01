<template>
  <div class="tree">
    <div ref="tools" class="tree-tools">
      <input v-model="query" class="tree-filter app-no-drag" placeholder="Поиск…" />
      <button type="button" class="tree-toggle app-no-drag" :class="{ on: filtered || filterOpen }" title="Что показывать" @click="filterOpen = !filterOpen">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" /></svg>
      </button>
      <div v-if="filterOpen" class="filter-pop app-no-drag">
        <label v-for="k in KINDS" :key="k.id" class="filter-opt">
          <input type="checkbox" :checked="show[k.id]" @change="toggleKind(k.id)" /> {{ k.label }}
        </label>
      </div>
    </div>

    <div class="tree-list">
      <template v-for="node in visibleGroups" :key="node.group.id">
        <div class="row group-row app-no-drag" :class="{ active: isActive(node.group) }" @click="$emit('select', node.group)">
          <button type="button" class="chevron" :class="{ open: !isCollapsed(node.group.id) }" :title="isCollapsed(node.group.id) ? 'Развернуть' : 'Свернуть'" @click.stop="toggle(node.group.id)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4" /></svg>
          </button>
          <span class="row-icon">🗂</span>
          <span class="row-name">{{ node.group.name }}</span>
          <span v-if="blockedCount(node.group, node.members)" class="row-blocked" :title="blockedTitle(node.group, node.members)">{{ blockedCount(node.group, node.members) }}</span>
        </div>
        <template v-if="!isCollapsed(node.group.id) || query">
          <ProjectRow v-for="p in node.members" :key="p.id" :project="p" nested />
        </template>
      </template>

      <ProjectRow v-for="p in visibleLoose" :key="p.id" :project="p" />

      <div v-if="!projectsStore.workProjects.length && !projectsStore.groups.length" class="tree-empty">Пока нет проектов</div>
      <div v-else-if="!visibleGroups.length && !visibleLoose.length && !visibleSources.length" class="tree-empty">Ничего не найдено</div>

      <div v-if="show.sources" class="section-label">
        <span>Справочники</span>
        <button type="button" class="section-add app-no-drag" title="Добавить справочник" @click="$emit('create', 'source')">+</button>
      </div>
      <div
        v-for="s in visibleSources"
        :key="s.id"
        class="row source-row app-no-drag"
        :class="{ active: isActive(s) }"
        :title="s.repo_path"
        @click="$emit('select', s)"
      >
        <span class="row-icon">📘</span>
        <span class="row-name">@{{ s.key }}</span>
      </div>
      <div v-if="show.sources && !projectsStore.sources.length" class="tree-empty">Папки, на которые можно сослаться через @</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Project, ProjectKind } from '@core/models'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import { useProjectsStore } from '../stores/projects'

interface Blocked { taskKey: string; reason: string }
const props = defineProps<{ currentId: string | null; blocked: (projectId: string) => Blocked[] }>()
const emit = defineEmits<{ select: [project: Project]; create: [kind: ProjectKind]; regroup: [project: Project, groupId: string | null] }>()
const projectsStore = useProjectsStore()

// Collapsed groups and what the list shows survive restarts.
const STORE_KEY = 'plangent.sidebar'
type Kind = 'groups' | 'projects' | 'sources'
const KINDS: { id: Kind; label: string }[] = [{ id: 'projects', label: 'Проекты' }, { id: 'groups', label: 'Группы' }, { id: 'sources', label: 'Справочники' }]
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} } })() as { collapsed?: string[]; show?: Partial<Record<Kind, boolean>> }
const collapsed = ref(new Set<string>(saved.collapsed ?? []))
const show = ref<Record<Kind, boolean>>({ projects: true, groups: true, sources: true, ...saved.show })
const query = ref('')
watch([collapsed, show], () => localStorage.setItem(STORE_KEY, JSON.stringify({ collapsed: [...collapsed.value], show: show.value })), { deep: true })

const filterOpen = ref(false)
const tools = ref<HTMLElement | null>(null)
const filtered = computed(() => Object.values(show.value).some(v => !v))
const closeFilter = (e: MouseEvent) => { if (!tools.value?.contains(e.target as Node)) filterOpen.value = false }
onMounted(() => document.addEventListener('mousedown', closeFilter))
onUnmounted(() => document.removeEventListener('mousedown', closeFilter))

// At least one kind stays on, so the list is never blank by accident.
function toggleKind(id: Kind) {
  if (show.value[id] && Object.values(show.value).filter(Boolean).length === 1) return
  show.value = { ...show.value, [id]: !show.value[id] }
}

const isCollapsed = (id: string) => collapsed.value.has(id)
function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}
const isActive = (p: Project) => p.id === props.currentId

const needle = computed(() => query.value.trim().toLowerCase())
const matches = (p: Project) => !needle.value || p.name.toLowerCase().includes(needle.value) || !!p.key?.includes(needle.value)
const visibleGroups = computed(() => show.value.groups ? projectsStore.groups.flatMap(group => {
  const groupHit = matches(group)
  const hits = projectsStore.members(group.id).filter(p => groupHit || matches(p))
  return groupHit || hits.length ? [{ group, members: show.value.projects ? hits : [] }] : []
}) : [])
// Without group rows, a group's projects are listed flat along with the loose ones.
const visibleLoose = computed(() => show.value.projects ? projectsStore.workProjects.filter(p => (!p.group_id || !show.value.groups) && matches(p)) : [])
const visibleSources = computed(() => show.value.sources ? projectsStore.sources.filter(matches) : [])

function blockedOf(group: Project, members: Project[]) {
  return [group, ...members].flatMap(p => props.blocked(p.id))
}
const blockedCount = (group: Project, members: Project[]) => blockedOf(group, members).length
const blockedTitle = (group: Project, members: Project[]) => blockedOf(group, members).map(b => `${b.taskKey}: ${b.reason}`).join('\n')

const ProjectRow = defineComponent({
  props: { project: { type: Object as () => Project, required: true }, nested: Boolean },
  setup(rowProps) {
    return () => {
      const p = rowProps.project
      const blocked = props.blocked(p.id)
      const menu: MenuItem[] = [
        { heading: 'Переместить в группу' },
        ...projectsStore.groups.filter(g => g.id !== p.group_id).map(g => ({ label: `🗂 ${g.name}`, action: () => emit('regroup', p, g.id) })),
        ...(p.group_id ? [{ label: 'Убрать из группы', action: () => emit('regroup', p, null) }] : []),
        ...(projectsStore.groups.length ? [] : [{ label: 'Групп пока нет', disabled: true }]),
      ]
      return h('div', { class: ['row', 'project-row', 'app-no-drag', { active: isActive(p), nested: rowProps.nested }], onClick: () => emit('select', p) }, [
        h('span', { class: 'row-icon' }, '📁'),
        h('span', { class: 'row-name' }, p.name),
        blocked.length ? h('span', { class: 'row-blocked', title: blocked.map(b => `${b.taskKey}: ${b.reason}`).join('\n') }, String(blocked.length)) : null,
        h('span', { class: 'row-menu', onClick: (e: Event) => e.stopPropagation() }, [h(AppMenu, { items: menu, size: 'xs', title: 'Ещё', align: 'left' })]),
      ])
    }
  },
})
</script>

<style scoped>
.tree { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.tree-tools { display: flex; gap: 4px; }
.tree-filter {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.tree-filter:focus { outline: none; border-color: var(--blue); }
.tree-tools { position: relative; }
.tree-toggle {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  cursor: pointer;
}
.tree-toggle svg { width: 14px; height: 14px; }
.tree-toggle:hover { color: var(--text); }
.tree-toggle.on { color: var(--blue-hover); border-color: var(--blue); background: var(--blue-soft); }
.filter-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  padding: 6px;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 60;
}
.filter-opt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); font-size: 13px; color: var(--text); cursor: pointer; }
.filter-opt:hover { background: var(--bg3); }

.tree-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.tree-empty { padding: 6px 10px; font-size: 12px; color: var(--text-faint); }

.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-3);
  padding: 0 6px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}
.section-add { width: 18px; height: 18px; background: none; border: none; border-radius: 4px; color: var(--text-faint); font-size: 15px; line-height: 1; cursor: pointer; }
.section-add:hover { background: var(--bg3); color: var(--text); }

:deep(.row) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 6px 0 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  transition: background 0.12s, color 0.12s;
}
:deep(.row.nested) { padding-left: 30px; }
.group-row { padding-left: 2px; }
:deep(.row:hover) { background: var(--bg3); color: var(--text); }
:deep(.row.active) { background: var(--bg3); color: var(--text); box-shadow: inset 2px 0 0 var(--blue); }
:deep(.row-icon) { width: 16px; flex-shrink: 0; text-align: center; font-size: 13px; }
:deep(.row-name) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:deep(.row-menu) { flex-shrink: 0; opacity: 0; transition: opacity 0.12s; }
:deep(.row:hover .row-menu), :deep(.row-menu:has(.menu.open)) { opacity: 1; }
.chevron {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-faint);
  cursor: pointer;
}
.chevron svg { width: 12px; height: 12px; transition: transform 0.12s; }
.chevron.open svg { transform: rotate(90deg); }
.chevron:hover { background: var(--bg-hover); color: var(--text); }
/* Tasks whose running queue is stuck until the developer answers; details in the tooltip. */
:deep(.row-blocked) {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--warning);
  color: #0d1117;
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
