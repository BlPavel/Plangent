<template>
  <div class="workspace" :class="{ split: panelOpen }">
    <section class="list-pane" :class="{ 'skills-pane': view === 'items' || view === 'review' || view === 'plan-review' || view === 'architecture-review' || view === 'qa-review' }">
      <div class="view-navigation"><AppTabs :model-value="view" :items="[{'value':'items','label':'Элементы'},{'value':'guide','label':'Руководство для агента'},{'value':'fixer','label':'Агент доработки'},{'value':'review','label':'Ревью МР'},{'value':'plan-review','label':'Ревью плана'},{'value':'architecture-review','label':'Ревью архитектуры'},{'value':'qa-review','label':'Ревью QA'},{'value':'commits','label':'Коммиты'},{'value':'branches','label':'Ветки'},{'value':'mr','label':'Merge request'}]" variant="side" label="Инструкции" @update:model-value="view = $event as typeof view" /></div>
      <div class="view-content">
      <SkillsManager v-if="view === 'items'" class="skills" scope="project" :project-id="projectId">
        <template #actions>
          <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Описать, что нужно, а агент предложит скилл, правку главного файла или команду" @click="panelOpen = true">
            ✦ Записать с агентом
            <span v-if="pending" class="pending" :title="`Ждут решения: ${pending}`">{{ pending }}</span>
          </AppButton>
        </template>
      </SkillsManager>
      <template v-else-if="view === 'review'">
        <p class="hint">Скиллы ревью задают, что проверять в МР. Без своих скиллов используется стандартный.</p>
        <SkillsManager class="skills" scope="project" :project-id="projectId" :allowed-types="['review-skill']">
          <template #actions>
            <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Агент изучит код проекта, расспросит вас и предложит скилл ревью" @click="panelOpen = true">✦ Написать с агентом</AppButton>
          </template>
        </SkillsManager>
      </template>
      <template v-else-if="view === 'plan-review'">
        <p class="hint">Скиллы ревью плана — ваши требования к плану в проекте (например, архитектурные). Общие проверки задаёт глобальная инструкция в настройках, она действует всегда; выбранный скилл добавляется к ней при запуске ревью.</p>
        <SkillsManager class="skills" scope="project" :project-id="projectId" :allowed-types="['plan-review-skill']">
          <template #actions>
            <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Агент изучит код проекта, расспросит вас и предложит скилл ревью плана" @click="panelOpen = true">✦ Написать с агентом</AppButton>
          </template>
        </SkillsManager>
      </template>
      <template v-else-if="view === 'architecture-review' || view === 'qa-review'">
        <p class="hint">Выбранный скилл добавляется к общей инструкции ревью из глобальных настроек.</p>
        <SkillsManager :key="view" class="skills" scope="project" :project-id="projectId" :allowed-types="[view === 'architecture-review' ? 'architecture-review-skill' : 'qa-review-skill']">
          <template #actions><AppButton v-if="!panelOpen" variant="subtle" size="sm" @click="panelOpen = true">✦ Написать с агентом</AppButton></template>
        </SkillsManager>
      </template>
      <InstructionGuideEditor v-else-if="view === 'guide'" scope="project" :project-id="projectId" />
      <CodeFixerInstructionEditor v-else-if="view === 'fixer'" scope="project" :project-id="projectId" />
      <ProjectGitPanel v-else-if="view === 'branches' || view === 'mr'" :project-id="projectId" :section="view" />
      <template v-else>
        <CommitSettings :project-id="projectId" />
        <CodeFixerInstructionEditor scope="project" type="commit-rules" :project-id="projectId" />
      </template>
      </div>
    </section>
    <LibrarianPanel v-if="panelOpen" class="panel" :project-id="projectId" :default-agent-id="defaultAgentId" @close="panelOpen = false" />
  </div>
</template>

<script setup lang="ts">
import AppTabs from '@shared/ui/AppTabs.vue'
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
const view = ref<'items' | 'guide' | 'fixer' | 'review' | 'plan-review' | 'architecture-review' | 'qa-review' | 'commits' | 'branches' | 'mr'>('items')
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
.list-pane { flex: 1; min-width: 0; overflow: hidden; padding: var(--sp-5) var(--sp-6); display: flex; gap: 12px; }
.view-navigation { flex: 0 0 200px; overflow-y: auto; }
.view-content { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.skills-pane { min-height: 0; overflow: hidden; }
.skills { flex: 1; min-height: 0; height: auto; }
.skills-pane > .hint { flex-shrink: 0; }
.split .list-pane { flex: 0 1 46%; min-width: 360px; }
.panel { flex: 1 1 54%; min-width: 420px; border-left: 1px solid var(--border); }

.views { display: flex; gap: 2px; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow-x: auto; }
.view { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 6px 10px; color: var(--text-muted); font: inherit; font-size: var(--fs-md); font-weight: 500; cursor: pointer; }
.view:hover { color: var(--text); }
.view { flex-shrink: 0; }
.view.active { color: var(--text); border-bottom-color: var(--blue); }

.hint { margin: 0; font-size: var(--fs-md); color: var(--text-muted); }
.pending { margin-left: 4px; font-size: var(--fs-xs); font-weight: 600; min-width: 16px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--blue); color: var(--on-accent); }
</style>
