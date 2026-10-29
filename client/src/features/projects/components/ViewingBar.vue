<template>
  <div v-if="workspace" class="viewing-bar" role="status">
    <span class="viewing-text">👁 Смотрю: <strong>{{ title }}</strong></span>
    <code class="viewing-branch">⎇ {{ workspace.branch }}</code>
    <span v-if="others" class="viewing-others">ещё {{ others }} {{ agentsWord }} работают</span>
    <span class="spacer" />
    <AppButton size="sm" @click="$emit('terminal')">Терминал</AppButton>
    <span class="viewing-back">Вернуться</span>
    <AppMenu :items="menu" icon="chevron" title="Вернуться" />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Workspace } from '@core/models'
import { useWorkStore, useWorkActions } from '@features/tasks'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'

const props = defineProps<{ workspace: Workspace | null; projectId: string }>()
defineEmits<{ terminal: [] }>()
const work = useWorkStore(), actions = useWorkActions()

const entry = computed(() => work.entries.find(e => e.workspace?.id === props.workspace?.id))
const title = computed(() => entry.value ? (entry.value.task.kind === 'errand' ? '⚡ ' + (entry.value.task.title || 'поручение') : entry.value.task.key + (entry.value.task.title ? ' ' + entry.value.task.title : '')) : props.workspace?.branch)
const others = computed(() => work.entries.filter(e => e.workspace?.id !== props.workspace?.id && e.workspace?.project_id === props.projectId).reduce((n, e) => n + e.state.counts.agents, 0))
const agentsWord = computed(() => others.value % 10 === 1 && others.value % 100 !== 11 ? 'агент' : 'агентов')
const menu = computed<MenuItem[]>(() => [
  { label: 'Основное место', hint: 'Вернуть Терминал и «Код» к папке проекта', action: () => void actions.view(props.projectId, null) },
  ...work.entries.filter(e => e.workspace && e.workspace.status === 'ready' && e.workspace.id !== props.workspace?.id && e.state.hasBranch).map(e => ({
    label: (e.task.kind === 'errand' ? '⚡ ' + (e.task.title || 'поручение') : e.task.key + ' ' + (e.task.title ?? '')),
    hint: '⎇ ' + e.workspace!.branch,
    action: () => void actions.view(props.projectId, e.workspace),
  })),
])
</script>
<style scoped>
.viewing-bar { display: flex; align-items: center; gap: var(--sp-3); padding: 6px var(--sp-5); background: var(--blue-soft); border-bottom: 1px solid var(--blue); font-size: 13px; flex-shrink: 0; }
.viewing-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewing-branch { padding: 1px 8px; border-radius: var(--radius-pill); background: var(--bg3); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewing-others { color: var(--text-muted); font-size: 12px; }
.spacer { flex: 1; }
.viewing-back { font-size: 12.5px; margin-right: -6px; }
</style>
