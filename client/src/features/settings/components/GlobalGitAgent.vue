<template>
  <section class="global-git">
    <GitAgentFields :model-value="own" :inherited="{}" fallback="Агент по умолчанию проекта" @update:model-value="change" />
    <GitAgentFields kind="review" :model-value="own" :inherited="{}" fallback="Агент по умолчанию проекта" @update:model-value="change" />
    <GitAgentFields kind="conflict" :model-value="own" :inherited="{}" fallback="Как агент для коммитов" @update:model-value="change" />
    <SaveStatus :state="state" />
  </section>
</template>

<script setup lang="ts">
import { projectsEndpoints } from '@features/projects'

import { ref } from 'vue'
import type { ProjectGitSettings } from '@contracts'
import { useAppStore } from '@core/stores/app'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import { errorText } from '@shared/utils/errorText'
import { GitAgentFields } from '@features/projects'

/** The app-wide git agent: every project and group without its own choice uses it. Saves on change. */
const app = useAppStore()
const own = ref<ProjectGitSettings>({}), state = ref<SaveState>('idle')
projectsEndpoints.getProjectsGitDefaults({ params: {  } }).then(data => { own.value = data.own }, cause => app.toast(errorText(cause), 'error'))
async function change(value: ProjectGitSettings) {
  own.value = value; state.value = 'saving'
  try { own.value = (await projectsEndpoints.putProjectsGitDefaults({ params: {  }, body: value })).own; state.value = 'saved' }
  catch (cause) { state.value = 'idle'; app.toast(errorText(cause), 'error') }
}
</script>

<style scoped>
.global-git { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
</style>
