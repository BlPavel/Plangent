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
      <ProjectGitPanel v-else-if="page === 'workspace' || page === 'branches' || page === 'mr'" :key="page" :project-id="project.id" :section="page" />
      <SkillsManager v-else-if="page === 'items'" class="skills" scope="project" :project-id="project.id" />
      <SkillsManager v-else-if="isSkillPage" :key="page" class="skills" scope="project" :project-id="project.id" :allowed-types="librarySection('project', page)!.types" />
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
export type ProjectSettingsPage = 'general' | 'git-agents' | 'workspace' | 'hosting' | 'branches' | 'mr' | 'items' | 'guide' | 'fixer' | 'commits' | 'review' | 'plan-review' | 'architecture-review' | 'qa-review'
</script>

<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import type { Project } from '@contracts'
import { AppButton, AppNavTree, AppPageHeader, AppSettingsLayout, navTreePage, type NavTreeItem } from '@shared/ui'
import { CodeFixerInstructionEditor, CommitSettings, InstructionGuideEditor, LibrarianPanel, SkillsManager, libraryAgentKey, pageTitledKey } from '@features/library'
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
      ...(isProject.value ? [{ page: 'workspace', label: 'Рабочее место' }, { page: 'hosting', label: 'Хостинг кода' }] : []),
      { page: 'branches', label: 'Ветки' },
      { page: 'mr', label: 'Merge request' },
    ],
  },
  {
    id: 'instructions', label: 'Инструкции',
    // Named like the same pages of the global settings.
    children: (['items', 'guide', 'fixer', 'commits'] as const).map(id => ({ page: id, label: id === 'guide' ? LIBRARY_SECTIONS.global['instruction-guide'].title : LIBRARY_SECTIONS.project[id].title })),
  },
  {
    id: 'review', label: 'Ревью',
    children: [{ page: 'review', label: 'Merge request' }, { page: 'plan-review', label: 'План' }, { page: 'architecture-review', label: 'Архитектура' }, { page: 'qa-review', label: 'QA' }],
  },
])
const header = computed(() => navTreePage(nav.value, page.value))
const isSkillPage = computed(() => ['review', 'plan-review', 'architecture-review', 'qa-review'].includes(page.value))
const owner = computed(() => isProject.value ? 'этого проекта' : 'этой группы')
// A project inherits from its group, the group from the global settings; a value set here overrides them.
const inherits = computed(() => isProject.value && props.project.group_id
  ? 'Что не задано здесь, берётся из настроек группы, затем из глобальных; заданное здесь их переопределяет.'
  : 'Что не задано здесь, берётся из глобальных настроек; заданное здесь их переопределяет.')
const description = computed(() => ({
  'git-agents': inherits.value,
  branches: inherits.value,
  mr: inherits.value,
  commits: inherits.value,
  guide: inherits.value,
  fixer: inherits.value,
  review: `Скиллы ревью добавляют требования ${owner.value} к общей инструкции ревью МР из глобальных настроек.`,
  'plan-review': 'Ваши требования к плану (например, архитектурные). Общие проверки задаёт глобальная инструкция, она действует всегда; выбранный скилл добавляется к ней при запуске ревью.',
  'architecture-review': 'Выбранный скилл добавляется к общей инструкции ревью из глобальных настроек.',
  'qa-review': 'Выбранный скилл добавляется к общей инструкции ревью из глобальных настроек.',
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
