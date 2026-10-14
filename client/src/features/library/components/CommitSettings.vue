<template>
  <section class="commit-settings">
    <h3>Сообщение коммита</h3>
    <label class="check">
      <input type="checkbox" :checked="value" :disabled="loading" @change="set(($event.target as HTMLInputElement).checked)" />
      Добавлять описание задачи в коммит
    </label>
    <div class="meta">
      <span>{{ own ? 'Задано здесь' : source === 'group' ? 'Из группы' : source === 'global' ? 'Из глобальных настроек' : 'По умолчанию' }}</span>
      <button v-if="own" type="button" class="link" @click="reset">Сбросить к {{ source === 'group' ? 'значению группы' : source === 'global' ? 'глобальному значению' : 'значению по умолчанию' }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import type { ProjectGitSettings } from '@core/models'

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
    const data = await api.get<{ values: ProjectGitSettings; sources: Record<string, string> }>(group ? `/projects/${encodeURIComponent(group)}/git-settings` : '/projects/git-defaults')
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
  const { include_description: _, ...rest } = project.value?.git_settings ?? {}
  return save(rest)
}
</script>

<style scoped>
.commit-settings { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
h3 { margin: 0; font-size: 14px; }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.check input { margin: 0; accent-color: var(--blue); }
.meta { display: flex; gap: 8px; font-size: 11.5px; color: var(--text-faint); }
.link { padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
</style>
