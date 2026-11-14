<template>
  <section class="execution-branch" aria-label="Ветка выполнения">
    <header class="branch-heading">
      <h3>Ветка выполнения</h3>
      <span class="branch-spacer" />
      <WhereToWork v-if="configurable" :model-value="modelValue" :project-id="task.project_id" ordinary :taken="taken" @update:model-value="$emit('update:modelValue', $event)" />
      <ChangeWorkBranch v-else-if="workspace?.status === 'ready' && !task.closed_at && task.status !== 'done'" :task="task" :workspace="workspace" :taken="taken" :locked-reason="lockedReason" @changed="changed" />
      <template v-else>
        <code :title="branch">{{ branch }}</code>
        <span class="branch-fixed">{{ workspace?.status === 'failed' ? 'Ошибка подготовки' : 'Закреплена за задачей' }}</span>
      </template>
    </header>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChangeWorkBranch from './ChangeWorkBranch.vue'
import type { Task, Workspace } from '@contracts'
import WhereToWork, { type WorkPlace } from './WhereToWork.vue'
import { useWorkStore } from '../stores/work'

const props = defineProps<{ task: Task; modelValue: WorkPlace; workspace?: Workspace | null; configurable: boolean; lockedReason?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: WorkPlace]; changed: [task: Task] }>()
async function changed(value: { task: Task; workspace: Workspace }) {
  const entry = work.entries.find(e => e.task.id === value.task.id)
  if (entry) { entry.task = value.task; entry.workspace = value.workspace }
  emit('changed', value.task)
  await work.load()
}
const work = useWorkStore()
const taken = computed(() => Object.fromEntries(work.entries.filter(e => e.task.project_id === props.task.project_id && e.task.id !== props.task.id && e.workspace && e.workspace.status !== 'removed' && !e.task.closed_at).map(e => [e.workspace!.branch, e.task.title || e.task.key])))
const branch = computed(() => props.workspace?.branch || props.task.branch_name || 'Текущая ветка проекта')
</script>

<style scoped>
.execution-branch { margin-bottom: 12px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.branch-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.branch-heading h3 { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 500; color: var(--text-muted); }
.branch-spacer { flex: 1; }
.branch-heading code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); color: var(--text); }
.branch-fixed { flex-shrink: 0; font-size: var(--fs-xs); color: var(--text-muted); }
</style>
