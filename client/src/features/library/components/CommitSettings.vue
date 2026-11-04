<template>
  <section class="commit-settings">
    <h3>Сообщение коммита</h3>
    <AppCheckbox :model-value="value" :disabled="loading" @update:model-value="set">
      Добавлять описание задачи в коммит
    </AppCheckbox>
    <div class="meta">
      <span>{{ own ? 'Задано здесь' : source === 'group' ? 'Из группы' : source === 'global' ? 'Из глобальных настроек' : 'По умолчанию' }}</span>
      <AppButton variant="link" size="md" v-if="own" type="button"  @click="reset">Сбросить к {{ source === 'group' ? 'значению группы' : source === 'global' ? 'глобальному значению' : 'значению по умолчанию' }}</AppButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import AppCheckbox from '@shared/ui/AppCheckbox.vue'
import { projectsEndpoints } from '@features/projects'
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import type { ProjectGitSettings } from '@contracts'

/** Commit-related git settings of a project or group, kept next to the commit rules. */
const props = defineProps<{ projectId: string }>()
const app = useAppStore(), projects = useProjectsStore()
const project = computed(() => projects.byId(props.projectId))
const inherited = ref(false), source = ref<'group' | 'global' | 'default'>('default'), loading = ref(false)
const own = computed(() => project.value?.git_settings?.include_description !== undefined)
const value = computed(() => project.value?.git_settings?.include_description ?? inherited.value)

watch(() => [props.projectId, project.value?.group_id], load, { immediate: true })

async function load() {
  loading.value = true
  try {
    const group = project.value?.group_id
    const data = await (group ? projectsEndpoints.gitSettings({ params: { id: group } }) : projectsEndpoints.getProjectsGitDefaults({ params: {} }))
    inherited.value = data.values.include_description ?? false
    // The group's own values come back from its endpoint as «project».
    const from = data.sources.include_description
    source.value = from === 'project' ? 'group' : from === 'global' ? 'global' : 'default'
  } catch (e) { app.toast(String(e), 'error') }
  finally { loading.value = false }
}

async function save(git_settings: ProjectGitSettings) {
  try { await projects.update(props.projectId, { git_settings }) }
  catch (e) { app.toast(String(e), 'error') }
}
const set = (checked: boolean) => save({ ...project.value?.git_settings, include_description: checked })
function reset() {
  const rest = { ...project.value?.git_settings }
  delete rest.include_description
  return save(rest)
}
</script>

<style scoped>
.commit-settings { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
h3 { margin: 0; font-size: var(--fs-base); }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-md); cursor: pointer; }
.check input { margin: 0; accent-color: var(--blue); }
.meta { display: flex; gap: 8px; font-size: var(--fs-sm); color: var(--text-faint); }
.link { padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
</style>
