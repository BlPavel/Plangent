<template>
  <div class="workspace" :class="{ split: panelOpen }">
    <section class="list-pane">
      <div class="views">
        <button type="button" class="view" :class="{ active: view === 'items' }" @click="view = 'items'">Элементы</button>
        <button type="button" class="view" :class="{ active: view === 'guide' }" @click="view = 'guide'">Руководство для агента</button>
        <button type="button" class="view" :class="{ active: view === 'fixer' }" @click="view = 'fixer'">Агент доработки</button>
      </div>
      <SkillsManager v-if="view === 'items'" scope="project" :project-id="projectId">
        <template #actions>
          <AppButton v-if="!panelOpen" variant="subtle" size="sm" title="Описать, что нужно, а агент предложит скилл, правку главного файла или команду" @click="panelOpen = true">
            ✦ Записать с агентом
            <span v-if="pending" class="pending" :title="`Ждут решения: ${pending}`">{{ pending }}</span>
          </AppButton>
        </template>
      </SkillsManager>
      <InstructionGuideEditor v-else-if="view === 'guide'" scope="project" :project-id="projectId" />
      <CodeFixerInstructionEditor v-else scope="project" :project-id="projectId" />
    </section>
    <LibrarianPanel v-if="panelOpen" class="panel" :project-id="projectId" :default-agent-id="defaultAgentId" @close="panelOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useLibraryStore } from '../stores/library'
import SkillsManager from './SkillsManager.vue'
import LibrarianPanel from './LibrarianPanel.vue'
import InstructionGuideEditor from './InstructionGuideEditor.vue'
import CodeFixerInstructionEditor from './CodeFixerInstructionEditor.vue'

/** «Инструкции» of a project or group: the library list, its authoring guide, the code-fixer instruction and the librarian chat beside them. */
const props = defineProps<{ projectId: string; defaultAgentId?: string | null }>()
const store = useLibraryStore()
const view = ref<'items' | 'guide' | 'fixer'>('items')
const panelOpen = ref(false)
const pending = computed(() => store.proposalsFor({ projectId: props.projectId }).filter(p => p.status === 'pending').length)

watch(() => props.projectId, id => {
  view.value = 'items'
  panelOpen.value = false
  void store.loadProposals(id).catch(() => {})
}, { immediate: true })
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

.pending { margin-left: 4px; font-size: 10px; font-weight: 600; min-width: 16px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--blue); color: #fff; }
</style>
