<template>
  <div class="work-finish">
    <div class="finish-body">
      <p v-if="closed" class="finish-note">Работа закрыта{{ task.close_reason === 'cancelled' ? ' (отменена)' : '' }}. Завершение доступно только для чтения.</p>
      <FinishPanel :key="task.id" :project-id="task.project_id" :task="{ id: task.id, key: task.key }" :workspace-id="workspace?.id" :branch="workspace?.branch ?? task.branch_name" :blocked="closed ? 'Работа закрыта' : git.writeBlocked" />
    </div>
    <footer class="finish-footer">
      <span class="finish-hint">Закрытие уберёт рабочее место{{ workspace ? ' ' + workspace.branch : '' }}; несохранённое молча не пропадёт.</span>
      <AppButton variant="primary" :disabled="closing || closed" @click="closeWork">{{ closing ? 'Закрываем…' : 'Закрыть работу' }}</AppButton>
    </footer>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Task, Workspace } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useGitStore } from '@features/code'
import { FinishPanel } from '@features/finish'
import AppButton from '@shared/ui/AppButton.vue'
import { useWorkActions } from '../composables/useWorkActions'

const props = defineProps<{ task: Task; workspace?: Workspace | null }>()
const emit = defineEmits<{ closed: [Task] }>()
const git = useGitStore(), app = useAppStore(), actions = useWorkActions()
const closing = ref(false)
const closed = computed(() => !!props.task.closed_at || props.task.status === 'done')
// The git store follows this work's workspace, so «Код» of the project keeps its own.
watch(() => [props.task.project_id, props.workspace?.id], () => { void git.start(props.task.project_id, props.workspace?.id) }, { immediate: true })
onBeforeUnmount(() => git.stop())

async function closeWork() {
  if (closing.value) return
  closing.value = true
  try {
    const task = await actions.close(props.task)
    if (task) { app.toast('Работа закрыта', 'success'); emit('closed', task) }
  } finally { closing.value = false }
}
</script>
<style scoped>
.work-finish { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.finish-body { flex: 1; min-height: 0; overflow: auto; max-width: 900px; width: 100%; margin: 0 auto; }
.finish-note { padding: 12px 16px; color: var(--text-muted); font-size: 12.5px; }
.finish-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px var(--sp-5); border-top: 1px solid var(--border); }
.finish-hint { font-size: 12px; color: var(--text-muted); }
</style>
