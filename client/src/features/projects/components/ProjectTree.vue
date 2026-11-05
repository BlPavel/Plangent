<template>
  <div class="tree">
    <div class="tree-tools">
      <AppInput v-model="query" size="sm" class="tree-filter app-no-drag" placeholder="Поиск…" />
      <span ref="filterAnchor" class="app-no-drag">
        <AppButton variant="ghost" size="sm" icon :pressed="filtered || filterOpen" title="Что показывать" @click="filterOpen = !filterOpen">
          <IconFilter />
        </AppButton>
      </span>
      <AppPopover v-model="filterOpen" :anchor="filterAnchor" align="right" role="group">
        <AppCheckbox v-for="k in KINDS" :key="k.id" block :model-value="show[k.id]" @update:model-value="toggleKind(k.id)">{{ k.label }}</AppCheckbox>
      </AppPopover>
    </div>

    <div class="tree-list">
      <template v-for="node in visibleGroups" :key="node.group.id">
        <AppTreeRow
          class="app-no-drag"
          :icon="GROUP_ICON"
          :name="node.group.name"
          :active="isActive(node.group)"
          :expanded="node.members.length ? !isCollapsed(node.group.id) : undefined"
          :count="badgeCount(node.group, node.members)"
          :count-title="badgeTitle(node.group, node.members)"
          @click="$emit('select', node.group)"
          @toggle="toggle(node.group.id)"
        />
        <template v-if="!isCollapsed(node.group.id) || query">
          <AppTreeRow v-for="p in node.members" :key="p.id" class="app-no-drag" v-bind="projectRow(p)" nested @click="$emit('select', p)" />
        </template>
      </template>

      <AppTreeRow v-for="p in visibleLoose" :key="p.id" class="app-no-drag" v-bind="projectRow(p)" @click="$emit('select', p)" />

      <div v-if="!projectsStore.workProjects.length && !projectsStore.groups.length" class="tree-empty">Пока нет проектов</div>
      <div v-else-if="!visibleGroups.length && !visibleLoose.length && !visibleSources.length" class="tree-empty">Ничего не найдено</div>

      <template v-if="visibleSources.length">
        <div class="section-label">Справочники</div>
        <AppTreeRow v-for="s in visibleSources" :key="s.id" class="app-no-drag" :icon="SOURCE_ICON" :name="'@' + s.key" :title="s.repo_path" :active="isActive(s)" @click="$emit('select', s)" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AppButton, AppCheckbox, AppInput, AppPopover, AppTreeRow, IconFilter } from '@shared/ui'
import { computed, onMounted, ref, watch } from 'vue'
import type { Project } from '@contracts'
import { useProjectsStore } from '../stores/projects'
import { useWorkAttentionStore } from '../stores/attention'

interface Blocked { taskKey: string; reason: string }
const props = defineProps<{ currentId: string | null; blocked: (projectId: string) => Blocked[] }>()
defineEmits<{ select: [project: Project] }>()
const projectsStore = useProjectsStore()
const attention = useWorkAttentionStore()
onMounted(() => void attention.load())

// The variation selector forces the emoji glyph, so the three icons render at the same size.
const GROUP_ICON = '🗂️'
const PROJECT_ICON = '📁'
const SOURCE_ICON = '📘'

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
const filterAnchor = ref<HTMLElement | null>(null)
const filtered = computed(() => Object.values(show.value).some(v => !v))

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
// Works waiting for the developer (any project); stuck queues are a part of them, so they are not added on top.
const attentionOf = (group: Project, members: Project[]) => [group, ...members].reduce((n, p) => n + attention.countFor(p.id), 0)
const badgeCount = (group: Project, members: Project[]) => Math.max(attentionOf(group, members), blockedCount(group, members))
const badgeTitle = (group: Project, members: Project[]) => [
  attentionOf(group, members) ? 'Работ ждут вашего действия: ' + attentionOf(group, members) : '',
  blockedTitle(group, members),
].filter(Boolean).join('\n')
const blockedTitle = (group: Project, members: Project[]) => blockedOf(group, members).map(b => `${b.taskKey}: ${b.reason}`).join('\n')

function projectRow(p: Project) {
  const blocked = props.blocked(p.id)
  const mine = attention.countFor(p.id)
  return {
    icon: PROJECT_ICON,
    name: p.name,
    active: isActive(p),
    count: Math.max(mine, blocked.length),
    countTitle: [mine ? 'Работ ждут вашего действия: ' + mine : '', ...blocked.map(b => `${b.taskKey}: ${b.reason}`)].filter(Boolean).join('\n'),
  }
}
</script>

<style scoped>
.tree { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.tree-tools { display: flex; gap: 4px; }
.tree-filter { flex: 1; }

.tree-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--sp-1); }
.tree-empty { padding: 6px 10px; font-size: var(--fs-sm); color: var(--text-faint); }

.section-label {
  margin-top: var(--sp-3);
  padding: 0 6px 4px;
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}
</style>
