<template>
  <div class="workspace" :class="{ split: panelOpen }">
    <section class="list-pane">
      <div class="views">
        <button type="button" class="view" :class="{ active: view === 'items' }" @click="view = 'items'">Элементы</button>
        <button type="button" class="view" :class="{ active: view === 'guide' }" @click="view = 'guide'">Руководство для агента</button>
        <button type="button" class="view" :class="{ active: view === 'fixer' }" @click="view = 'fixer'">Агент доработки</button>
        <button type="button" class="view" :class="{ active: view === 'review' }" @click="view = 'review'">Ревью</button>
        <button type="button" class="view" :class="{ active: view === 'commits' }" @click="view = 'commits'">Коммиты</button>
        <button type="button" class="view" :class="{ active: view === 'branches' }" @click="view = 'branches'">Ветки</button>
        <button type="button" class="view" :class="{ active: view === 'mr' }" @click="view = 'mr'">Merge request</button>
      </div>
      <SkillsManager v-if="view === 'items'" scope="project" :project-id="projectId">
        <template #actions>
          <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Описать, что нужно, а агент предложит скилл, правку главного файла или команду" @click="panelOpen = true">
            ✦ Записать с агентом
            <span v-if="pending" class="pending" :title="`Ждут решения: ${pending}`">{{ pending }}</span>
          </AppButton>
        </template>
      </SkillsManager>
      <template v-else-if="view === 'review'">
        <p class="hint">Скиллы ревью говорят агенту во вкладке «Ревью», что важно в МР этого проекта и что пропускать. Перед разбором вы выбираете один из них; без скиллов работает стандартный.</p>
        <SkillsManager scope="project" :project-id="projectId" :allowed-types="['review-skill']">
          <template #actions>
            <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Агент изучит код проекта, расспросит вас и предложит скилл ревью" @click="panelOpen = true">✦ Написать с агентом</AppButton>
          </template>
        </SkillsManager>
      </template>
      <InstructionGuideEditor v-else-if="view === 'guide'" scope="project" :project-id="projectId" />
      <CodeFixerInstructionEditor v-else-if="view === 'fixer'" scope="project" :project-id="projectId" />
      <ProjectGitPanel v-else-if="view === 'branches' || view === 'mr'" :project-id="projectId" :section="view" />
      <template v-else>
        <CommitSettings :project-id="projectId" />
        <CodeFixerInstructionEditor scope="project" type="commit-rules" :project-id="projectId" />
      </template>
    </section>
    <LibrarianPanel v-if="panelOpen" class="panel" :project-id="projectId" :default-agent-id="defaultAgentId" @close="panelOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { ProjectGitPanel } from '@features/projects'
import { useLibraryStore } from '../stores/library'
import SkillsManager from './SkillsManager.vue'
import LibrarianPanel from './LibrarianPanel.vue'
import InstructionGuideEditor from './InstructionGuideEditor.vue'
import CodeFixerInstructionEditor from './CodeFixerInstructionEditor.vue'
import CommitSettings from './CommitSettings.vue'

/** «Инструкции» of a project or group: the library list, its authoring guide, the code-fixer instruction and the librarian chat beside them. */
/** `requested` opens a section from outside (the Ревью tab asks for its skills). */
const props = defineProps<{ projectId: string; defaultAgentId?: string | null; requested?: { view: 'review'; at: number } | null }>()
const store = useLibraryStore()
const view = ref<'items' | 'guide' | 'fixer' | 'review' | 'commits' | 'branches' | 'mr'>('items')
const panelOpen = ref(false)
const pending = computed(() => store.proposalsFor({ projectId: props.projectId }).filter(p => p.status === 'pending').length)

watch(() => props.projectId, id => {
  view.value = 'items'
  panelOpen.value = false
  void store.loadProposals(id).catch(() => {})
}, { immediate: true })
watch(() => props.requested?.at, () => { if (props.requested) view.value = props.requested.view }, { immediate: true })
</script>

<style scoped>
.workspace { display: flex; height: 100%; min-height: 0; }
.list-pane { flex: 1; min-width: 0; overflow-y: auto; padding: var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: 12px; }
.split .list-pane { flex: 0 1 46%; min-width: 360px; }
.panel { flex: 1 1 54%; min-width: 420px; border-left: 1px solid var(--border); }

.views { display: flex; gap: 2px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.view { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 6px 10px; color: var(--text-muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.view:hover { color: var(--text); }
.view.active { color: var(--text); border-bottom-color: var(--blue); }

.hint { margin: 0; font-size: 12.5px; color: var(--text-muted); }
.pending { margin-left: 4px; font-size: 10px; font-weight: 600; min-width: 16px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--blue); color: #fff; }
</style>
