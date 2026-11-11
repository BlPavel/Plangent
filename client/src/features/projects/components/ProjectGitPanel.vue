<template>
  <div v-if="project" class="git-panel">
    <template v-if="section === 'agent'">
      <GitAgentFields
        :model-value="gitSettings" :inherited="inherited" :source="inheritedSources.git_agent_id"
        :fallback="project.kind === 'group' ? 'Агент по умолчанию каждого проекта' : 'Агент по умолчанию'" @update:model-value="change"
      />
      <GitAgentFields
        kind="review" :model-value="gitSettings" :inherited="inherited" :source="inheritedSources.review_agent_id"
        :fallback="project.kind === 'group' ? 'Агент по умолчанию каждого проекта' : 'Агент по умолчанию'" @update:model-value="change"
      />
      <GitAgentFields
        kind="conflict" :model-value="gitSettings" :inherited="inherited" :source="inheritedSources.conflict_agent_id"
        fallback="Как агент для коммитов" @update:model-value="change"
      />
    </template>
    <GitSettingsFields
      v-else :model-value="gitSettings" :section="section" :branches="branchNames" :members="members" :members-note="membersNote"
      :inherited="inherited" :sources="inheritedSources" :group="project.kind === 'group'" @update:model-value="change"
    />
    <p v-if="error" role="alert" class="git-error">{{ error }}</p>
    <SaveStatus :state="saveState" />
  </div>
</template>

<script setup lang="ts">
import { codeEndpoints } from '@features/code'
import { projectsEndpoints } from '../api'

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ProjectGitSettings } from '@contracts'
import { useAppStore } from '@core/stores/app'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'
import GitSettingsFields from './GitSettingsFields.vue'
import GitAgentFields from './GitAgentFields.vue'

/** One git page of the project or group settings: agents, work place, branches or merge requests. Saves as you edit. */
const props = defineProps<{ projectId: string; section: 'branches' | 'mr' | 'agent' | 'workspace' }>()
const app = useAppStore(), projects = useProjectsStore()
const project = computed(() => projects.byId(props.projectId))

const gitSettings = ref<ProjectGitSettings>({})
const inherited = ref<ProjectGitSettings>({}), inheritedSources = ref<Record<string, string>>({})
const error = ref('')
const branchNames = ref<string[]>([])
const members = ref<{ value: string; login: string; name: string }[]>([]), membersNote = ref('')
const saveState = ref<SaveState>('idle')

watch(() => props.projectId, () => { gitSettings.value = { ...project.value?.git_settings } }, { immediate: true })

watch(() => [props.projectId, props.section], async () => {
  const p = project.value
  error.value = ''
  if (!p) return
  try {
    const group = p.group_id
    const data = await (group ? projectsEndpoints.gitSettings({ params: { id: group } }) : projectsEndpoints.getProjectsGitDefaults({ params: {} }))
    if (p.id !== props.projectId) return
    inherited.value = data.values
    // The group's own values come back from its endpoint as «project».
    inheritedSources.value = Object.fromEntries(Object.entries(data.sources).map(([key, source]) => [key, source === 'project' ? 'group' : source]))
    // Only a project has a repository to list branches from.
    if (props.section === 'branches' && p.kind === 'project') {
      const list = await codeEndpoints.getProjectsByProjectIdGitBranches({ params: { projectId: p.id }, query: {} })
      if (p.id === props.projectId) branchNames.value = [...new Set(list.map(b => b.name))]
    }
    // Reviewers are picked from the people the code host knows for this repository; without a host they are typed.
    if (props.section === 'mr' && p.kind === 'project') {
      try {
        const list = await projectsEndpoints.getProjectsByIdHostMembers({ params: { id: p.id } })
        if (p.id === props.projectId) { members.value = list; membersNote.value = '' }
      } catch (cause) { if (p.id === props.projectId) { members.value = []; membersNote.value = 'Список участников недоступен (' + errorText(cause) + ') — введите логин или ID вручную, Enter — добавить.' } }
    }
  } catch (cause) { if (p.id === props.projectId) error.value = errorText(cause) }
}, { immediate: true })

// Typing in a text field saves after a pause; a click saves at once. A pending save is flushed on leaving.
let timer: ReturnType<typeof setTimeout> | undefined, pending: (() => Promise<void>) | undefined
function change(value: ProjectGitSettings) {
  gitSettings.value = value
  const id = props.projectId
  pending = () => save(id, value)
  clearTimeout(timer)
  saveState.value = 'pending'
  timer = setTimeout(flush, 600)
}
function flush() { clearTimeout(timer); const run = pending; pending = undefined; return run?.() }
async function save(id: string, value: ProjectGitSettings) {
  saveState.value = 'saving'
  try { await projects.update(id, { git_settings: value }); saveState.value = 'saved' }
  catch (e) { saveState.value = 'idle'; app.toast(errorText(e), 'error') }
}
onBeforeUnmount(() => { void flush() })
</script>

<style scoped>
.git-panel { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.git-error { font-size: var(--fs-sm); color: var(--danger-hover); }
</style>
