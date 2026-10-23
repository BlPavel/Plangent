<template>
  <section class="global-git">
    <GitAgentFields :model-value="own" :inherited="{}" fallback="Агент по умолчанию проекта" @update:model-value="change" />
    <GitAgentFields kind="review" :model-value="own" :inherited="{}" fallback="Агент по умолчанию проекта" @update:model-value="change" />
    <SaveStatus :state="state" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@core/api'
import type { ProjectGitSettings } from '@core/models'
import { useAppStore } from '@core/stores/app'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import { errorText } from '@shared/utils/errorText'
import { GitAgentFields } from '@features/projects'

/** The app-wide git agent: every project and group without its own choice uses it. Saves on change. */
const app = useAppStore()
const own = ref<ProjectGitSettings>({}), state = ref<SaveState>('idle')
api.get<{ own: ProjectGitSettings }>('/projects/git-defaults').then(data => { own.value = data.own }, cause => app.toast(errorText(cause), 'error'))
async function change(value: ProjectGitSettings) {
  own.value = value; state.value = 'saving'
  try { own.value = (await api.put<{ own: ProjectGitSettings }>('/projects/git-defaults', value)).own; state.value = 'saved' }
  catch (cause) { state.value = 'idle'; app.toast(errorText(cause), 'error') }
}
</script>

<style scoped>
.global-git { display: flex; flex-direction: column; gap: 4px; max-width: 720px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
</style>
