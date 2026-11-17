<template>
  <AppSettingsLayout>
    <template #nav><AppNavTree :model-value="page" :items="nav" :label="isProject ? 'Настройки проекта' : 'Настройки группы'" @update:model-value="page = $event as Page" /></template>
    <template #header><AppPageHeader :parent="header.parent" :title="header.title" :description="description" /></template>

    <div class="page-body">
      <template v-if="page === 'general'">
        <ProjectGeneralSettings :project="project" section="general" />
        <section class="danger-zone">
          <h3>Удаление</h3>
          <p class="hint">{{ isProject ? 'Задачи, чаты и настройки проекта удаляются безвозвратно. Папка на диске не меняется.' : 'Можно удалить только группу — её проекты останутся без группы — или вместе с проектами.' }}</p>
          <AppButton class="danger-action" variant="danger-ghost" size="sm" @click="emit('delete')">{{ isProject ? 'Удалить проект' : 'Удалить группу' }}</AppButton>
        </section>
      </template>
      <ProjectGeneralSettings v-else-if="page === 'hosting'" :project="project" section="hosting" />
      <ProjectGitPanel v-else-if="page === 'git-agents'" :project-id="project.id" section="agent" />
      <ProjectGitPanel v-else-if="page === 'review-agent'" :project-id="project.id" section="review-agent" />
      <ProjectGitPanel v-else-if="page === 'workspace-files' || page === 'workspace-setup' || page === 'branches'" :key="page" :project-id="project.id" :section="page" />
      <template v-else-if="page === 'mr'">
        <ProjectGitPanel :project-id="project.id" section="mr" />
        <CodeFixerInstructionEditor scope="project" :type="LIBRARY_SECTIONS.project.mr.types[0]" :project-id="project.id" />
      </template>
      <SkillsManager v-else-if="page === 'items'" class="skills" scope="project" :project-id="project.id" />
      <PlanTemplateEditor v-else-if="templateType" :key="page" scope="project" :type="templateType" :project-id="project.id" />
      <CodeFixerInstructionEditor v-else-if="reviewType" :key="page" scope="project" :type="reviewType" :project-id="project.id" />
      <InstructionGuideEditor v-else-if="page === 'guide'" scope="project" :project-id="project.id" />
      <CodeFixerInstructionEditor v-else-if="page === 'fixer'" scope="project" :project-id="project.id" />
      <template v-else-if="page === 'commits'">
        <CommitSettings :project-id="project.id" />
        <CodeFixerInstructionEditor scope="project" :type="LIBRARY_SECTIONS.project.commits.types[0]" :project-id="project.id" />
      </template>
    </div>

    <template v-if="agentOpen && libraryPage" #panel>
      <LibrarianPanel :key="page" :section="page" :project-id="project.id" :default-agent-id="projectsStore.agentFor(project)" :request="agentRequest" @close="agentOpen = false" />
    </template>
  </AppSettingsLayout>
</template>

<script lang="ts">
export type ProjectSettingsPage = 'general' | 'git-agents' | 'review-agent' | 'workspace-files' | 'workspace-setup' | 'hosting' | 'branches' | 'mr' | 'items' | 'guide' | 'fixer' | 'commits' | 'plan-template' | 'architecture-template' | 'qa-template' | 'mr-review' | 'plan-review' | 'architecture-review' | 'qa-review'
</script>

<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import type { Project } from '@contracts'
import { AppButton, AppNavTree, AppPageHeader, AppSettingsLayout, navTreePage, type NavTreeItem } from '@shared/ui'
import { CodeFixerInstructionEditor, CommitSettings, InstructionGuideEditor, LibrarianPanel, PlanTemplateEditor, SkillsManager, libraryAgentKey, pageTitledKey } from '@features/library'
import { librarySection, LIBRARY_SECTIONS } from '../../../../../common/library-registry'
import { useProjectsStore } from '../stores/projects'
import ProjectGeneralSettings from './ProjectGeneralSettings.vue'
import ProjectGitPanel from './ProjectGitPanel.vue'

type Page = ProjectSettingsPage
/** The settings of a project or group, laid out like the global settings; `requested` opens a page from outside (the Ревью tab asks for its skills). */
const props = defineProps<{ project: Project; requested?: { page: Page; at: number } | null }>()
const emit = defineEmits<{ delete: [] }>()
const projectsStore = useProjectsStore()

const isProject = computed(() => props.project.kind === 'project')
const page = ref<Page>('general')
watch(() => props.requested?.at, () => { if (props.requested) page.value = props.requested.page }, { immediate: true })

const nav = computed<NavTreeItem[]>(() => [
  { id: 'general', label: 'Основное', page: 'general' },
  {
    id: 'git', label: 'Git',
    children: [
      { page: 'git-agents', label: 'Агенты' },
      ...(isProject.value ? [{ page: 'hosting', label: 'Хостинг кода' }] : []),
      { page: 'branches', label: 'Ветки' },
      { page: 'commits', label: 'Коммиты' },
      { page: 'mr', label: 'Merge request' },
    ],
  },
  {
    id: 'workspace', label: 'Рабочее место',
    children: [{ page: 'workspace-files', label: 'Файлы' }, { page: 'workspace-setup', label: 'Подготовка' }],
  },
  {
    id: 'templates', label: 'Шаблоны',
    children: [{ page: 'plan-template', label: 'План' }, { page: 'architecture-template', label: 'Архитектура' }, { page: 'qa-template', label: 'QA' }],
  },
  {
    id: 'instructions', label: 'Инструкции',
    // Named like the same pages of the global settings.
    children: (['items', 'guide', 'fixer'] as const).map(id => ({ page: id, label: id === 'guide' ? LIBRARY_SECTIONS.global['instruction-guide'].title : LIBRARY_SECTIONS.project[id].title })),
  },
  {
    id: 'review', label: 'Ревью',
    children: [{ page: 'review-agent', label: 'Агенты' }, { page: 'mr-review', label: 'Merge request' }, { page: 'plan-review', label: 'План' }, { page: 'architecture-review', label: 'Архитектура' }, { page: 'qa-review', label: 'QA' }],
  },
])
const header = computed(() => navTreePage(nav.value, page.value))
// The templates and the review instructions are texts: the nearest level applies, like in the global settings.
const templateType = computed(() => (['plan-template', 'architecture-template', 'qa-template'] as const).find(id => id === page.value))
const reviewPage = computed(() => (['mr-review', 'plan-review', 'architecture-review', 'qa-review'] as const).find(id => id === page.value))
const reviewType = computed(() => reviewPage.value && LIBRARY_SECTIONS.project[reviewPage.value].types[0])
// A project inherits from its group, the group from the global settings; a value set here overrides them.
const inherits = computed(() => isProject.value && props.project.group_id
  ? 'Что не задано здесь, берётся из настроек группы, затем из глобальных; заданное здесь их переопределяет.'
  : 'Что не задано здесь, берётся из глобальных настроек; заданное здесь их переопределяет.')
const description = computed(() => ({
  'git-agents': inherits.value,
  'review-agent': inherits.value,
  'workspace-files': `Для каждой работы Plangent создаёт отдельную рабочую копию проекта (git worktree) на своей ветке, поэтому параллельные работы не мешают друг другу. В неё попадает только закоммиченное: файлы вне git нужно скопировать. ${inherits.value}`,
  'workspace-setup': `Рабочая копия создаётся без зависимостей и сборки: их готовит эта команда. ${inherits.value}`,
  branches: inherits.value,
  mr: inherits.value,
  commits: inherits.value,
  guide: inherits.value,
  fixer: inherits.value,
  'plan-template': inherits.value,
  'architecture-template': inherits.value,
  'qa-template': inherits.value,
  'mr-review': inherits.value,
  'plan-review': inherits.value,
  'architecture-review': inherits.value,
  'qa-review': inherits.value,
} as Partial<Record<Page, string>>)[page.value])

// «Написать с агентом» in the lists and editors: the librarian chat of this page opens beside it.
const libraryPage = computed(() => !!librarySection('project', page.value))
const agentOpen = ref(false)
const agentRequest = ref<{ text: string; at: number } | null>(null)
watch(page, () => { agentRequest.value = null })
provide(libraryAgentKey, { open: text => { agentRequest.value = { text, at: Date.now() }; agentOpen.value = true } })
// Every editor below sits under the page header, so they skip their own title.
provide(pageTitledKey, true)
</script>

<style scoped>
.page-body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sp-4) var(--sp-6) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); }
.skills { flex: 1; min-height: 0; height: auto; }
.danger-zone { display: flex; flex-direction: column; gap: var(--sp-2); max-width: 720px; padding-top: var(--sp-4); border-top: 1px solid var(--border); }
.danger-zone h3 { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.danger-action { align-self: flex-start; }
.hint { font-size: var(--fs-sm); color: var(--text-muted); }
</style>
