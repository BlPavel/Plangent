<template>
  <div class="group-projects">
    <div class="gp-actions">
      <AppButton variant="primary" @click="create">+ Проект</AppButton>
      <AppMenu v-if="loose.length" :items="addMenu" size="sm" title="Добавить существующий" align="left" />
      <span v-if="loose.length" class="gp-hint">добавить существующий</span>
    </div>

    <div v-if="!members.length" class="gp-empty">В группе пока нет проектов. Создайте новый или добавьте существующий.</div>
    <AppItemCard v-for="p in members" :key="p.id" class="gp-card" interactive actions-align="center" @click="appStore.currentProject = p">
      <template #lead><span class="gp-icon" aria-hidden="true">📁</span></template>
      <template #title>{{ p.name }} <code class="gp-key">@{{ p.key }}</code></template>
      <template #subtitle>{{ p.repo_path }}</template>
      <template #actions>
        <AppCount v-if="p.active_tasks" :value="p.active_tasks" tone="info" title="Активных задач" />
        <span class="gp-menu" @click.stop @keydown.stop><AppMenu :items="menu(p)" size="xs" title="Ещё" /></span>
      </template>
    </AppItemCard>

    <ProjectFormModal v-model="showForm" kind="project" :group-id="group.id" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '@contracts'
import { useRouter } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { AppButton, AppCount, AppItemCard } from '@shared/ui'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import { useProjectsStore } from '../stores/projects'
import ProjectFormModal from './ProjectFormModal.vue'

/** A group's «Проекты» tab: everything you do to a project (open, edit, leave, delete) without leaving the group. */
const props = defineProps<{ group: Project }>()
const appStore = useAppStore()
const router = useRouter()
const projectsStore = useProjectsStore()

const members = computed(() => projectsStore.members(props.group.id))
const loose = computed(() => projectsStore.workProjects.filter(p => !p.group_id))
const showForm = ref(false)

function create() { showForm.value = true }
function edit(p: Project) { appStore.currentProject = p; void router.push({ path: '/', query: { tab: 'settings' } }) }

async function move(p: Project, groupId: string | null) {
  try { await projectsStore.update(p.id, { group_id: groupId }) } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function remove(p: Project) {
  if (!(await appStore.confirm(`Удалить проект «${p.name}»? Все его задачи, чаты и настройки будут удалены безвозвратно.`, { confirmLabel: 'Удалить', danger: true }))) return
  try { await projectsStore.remove(p.id); appStore.toast('Удалено', 'success') } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

const menu = (p: Project): MenuItem[] => [
  { label: 'Открыть', action: () => { appStore.currentProject = p } },
  { label: 'Настройки', action: () => edit(p) },
  { separator: true },
  { label: 'Убрать из группы', hint: 'Проект останется, но выйдет из группы', action: () => move(p, null) },
  { label: 'Удалить', danger: true, action: () => remove(p) },
]
const addMenu = computed<MenuItem[]>(() => loose.value.map(p => ({ label: `📁 ${p.name}`, action: () => move(p, props.group.id) })))
</script>

<style scoped>
.group-projects { display: flex; flex-direction: column; gap: 8px; padding: var(--sp-4) var(--page-inset, var(--sp-4)); overflow-y: auto; }
.gp-actions { display: flex; align-items: center; gap: 6px; }
.gp-hint { font-size: var(--fs-sm); color: var(--text-faint); }
.gp-empty { padding: 20px 0; font-size: var(--fs-md); color: var(--text-faint); }
.gp-icon { font-size: var(--fs-lg); }
.gp-key { font-size: var(--fs-xs); font-weight: var(--fw-medium); color: var(--text-faint); }
.gp-menu { display: flex; align-items: center; opacity: 0; transition: opacity var(--motion-fast); }
.gp-card:hover .gp-menu, .gp-card:focus-within .gp-menu { opacity: 1; }
</style>
