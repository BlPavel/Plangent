<template>
  <div class="group-projects">
    <div class="gp-actions">
      <AppButton variant="primary" @click="create">+ Проект</AppButton>
      <AppMenu v-if="loose.length" :items="addMenu" size="sm" title="Добавить существующий" align="left" />
      <span v-if="loose.length" class="gp-hint">добавить существующий</span>
    </div>

    <div v-if="!members.length" class="gp-empty">В группе пока нет проектов. Создайте новый или добавьте существующий.</div>
    <div v-for="p in members" :key="p.id" class="gp-card" @click="appStore.currentProject = p">
      <span class="gp-icon">📁</span>
      <span class="gp-text">
        <span class="gp-name">{{ p.name }} <code class="gp-key">@{{ p.key }}</code></span>
        <span class="gp-path">{{ p.repo_path }}</span>
      </span>
      <span v-if="p.active_tasks" class="gp-active" title="Активных задач">{{ p.active_tasks }}</span>
      <span class="gp-menu" @click.stop><AppMenu :items="menu(p)" size="xs" title="Ещё" /></span>
    </div>

    <ProjectFormModal v-model="showForm" kind="project" :project="editing" :group-id="group.id" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '@core/models'
import { useAppStore } from '@core/stores/app'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import { useProjectsStore } from '../stores/projects'
import ProjectFormModal from './ProjectFormModal.vue'

/** A group's «Проекты» tab: everything you do to a project (open, edit, leave, delete) without leaving the group. */
const props = defineProps<{ group: Project }>()
const appStore = useAppStore()
const projectsStore = useProjectsStore()

const members = computed(() => projectsStore.members(props.group.id))
const loose = computed(() => projectsStore.workProjects.filter(p => !p.group_id))
const showForm = ref(false)
const editing = ref<Project | null>(null)

function create() { editing.value = null; showForm.value = true }
function edit(p: Project) { editing.value = p; showForm.value = true }

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
.group-projects { display: flex; flex-direction: column; gap: 8px; padding: var(--sp-4); overflow-y: auto; }
.gp-actions { display: flex; align-items: center; gap: 6px; }
.gp-hint { font-size: 12px; color: var(--text-faint); }
.gp-empty { padding: 20px 0; font-size: 13px; color: var(--text-faint); }
.gp-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.gp-card:hover { border-color: var(--border-strong); background: var(--bg3); }
.gp-icon { font-size: 16px; }
.gp-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.gp-name { font-size: 14px; font-weight: 500; }
.gp-key { margin-left: 6px; font-size: 11px; color: var(--text-faint); }
.gp-path { font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-active { min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
.gp-menu { opacity: 0; transition: opacity 0.12s; }
.gp-card:hover .gp-menu, .gp-menu:has(.menu.open) { opacity: 1; }
</style>
