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
    </template>
    <GitSettingsFields
      v-else :model-value="gitSettings" :section="section" :branches="branchNames" :members="members" :members-note="membersNote"
      :inherited="inherited" :sources="inheritedSources" @update:model-value="change"
    />
    <p v-if="error" role="alert" class="git-error">{{ error }}</p>
    <SaveStatus :state="saveState" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '@core/api'
import type { ProjectGitSettings } from '@core/models'
import { useAppStore } from '@core/stores/app'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'
import GitSettingsFields from './GitSettingsFields.vue'
import GitAgentFields from './GitAgentFields.vue'

/** One git topic of a project or group, shown as a sub-tab of «Инструкции»: branches or merge requests. Saves as you edit. */
const props = defineProps<{ projectId: string; section: 'branches' | 'mr' | 'agent' }>()
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
    const data = await api.get<{ values: ProjectGitSettings; sources: Record<string, string> }>(group ? '/projects/' + encodeURIComponent(group) + '/git-settings' : '/projects/git-defaults')
    if (p.id !== props.projectId) return
    inherited.value = data.values
    // The group's own values come back from its endpoint as «project».
    inheritedSources.value = Object.fromEntries(Object.entries(data.sources).map(([key, source]) => [key, source === 'project' ? 'group' : source]))
    // Only a project has a repository to list branches from.
    if (props.section === 'branches' && p.kind === 'project') {
      const list = await api.get<{ branches: { name: string }[] }>('/projects/' + encodeURIComponent(p.id) + '/branch-review/branches')
      if (p.id === props.projectId) branchNames.value = [...new Set(list.branches.map(b => b.name))]
    }
    // Reviewers are picked from the people the code host knows for this repository; without a host they are typed.
    if (props.section === 'mr' && p.kind === 'project') {
      try {
        const list = await api.get<typeof members.value>('/projects/' + encodeURIComponent(p.id) + '/host-members')
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
.git-error { font-size: 12px; color: var(--danger-hover); }
</style>
