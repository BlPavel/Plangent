<template>
  <section class="execution-branch" aria-label="Ветка выполнения">
    <header class="branch-heading">
      <svg class="branch-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6v8m8-8v2a3 3 0 01-3 3H6" stroke="currentColor" stroke-width="1.5" /><circle cx="6" cy="4" r="2" stroke="currentColor" stroke-width="1.5" /><circle cx="6" cy="16" r="2" stroke="currentColor" stroke-width="1.5" /><circle cx="14" cy="4" r="2" stroke="currentColor" stroke-width="1.5" /></svg>
      <div class="branch-summary">
        <h3>Ветка выполнения</h3>
        <code :title="branch">{{ branch }}</code>
      </div>
      <AppButton v-if="configurable" ref="toggle" size="xs" :aria-expanded="editing" @click="editing = !editing">{{ editing ? 'Свернуть' : 'Изменить ветку' }}</AppButton>
      <span v-else class="branch-fixed">{{ workspace?.status === 'failed' ? 'Ошибка подготовки' : 'Закреплена за задачей' }}</span>
    </header>
    <p v-if="editing" class="branch-caption">{{ caption }}</p>
    <div v-if="editing && configurable" class="branch-editor">
      <WhereToWork ref="where" :model-value="modelValue" :project-id="task.project_id" ordinary inline :taken="taken" @update:model-value="$emit('update:modelValue', $event)" />
      <div class="branch-editor-footer">
        <span>Выбор применится при запуске очереди.</span>
        <AppButton size="sm" variant="blue" :disabled="where?.invalid" @click="finish">Готово</AppButton>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Task, Workspace } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import WhereToWork, { type WorkPlace } from './WhereToWork.vue'
import { useWorkStore } from '../stores/work'

const props = defineProps<{ task: Task; modelValue: WorkPlace; workspace?: Workspace | null; configurable: boolean }>()
defineEmits<{ 'update:modelValue': [value: WorkPlace] }>()
const work = useWorkStore()
const editing = ref(false)
const where = ref<InstanceType<typeof WhereToWork>>()
const toggle = ref<InstanceType<typeof AppButton>>()
const taken = computed(() => Object.fromEntries(work.entries.filter(e => e.task.project_id === props.task.project_id && e.task.id !== props.task.id && e.workspace && e.workspace.status !== 'removed' && !e.task.closed_at).map(e => [e.workspace!.branch, e.task.title || e.task.key])))
const branch = computed(() => !props.configurable
  ? props.workspace?.branch || props.task.branch_name || 'Текущая ветка проекта'
  : props.modelValue.place === 'existing' ? props.modelValue.branch || 'Выберите существующую ветку' : props.modelValue.branch_name || 'Укажите имя новой ветки')
const caption = computed(() => !props.configurable
  ? 'Очередь продолжит работу в этой ветке.'
  : props.modelValue.place === 'new' ? `Новая ветка от ${props.modelValue.base_branch ? 'origin/' + props.modelValue.base_branch : 'базовой ветки проекта'}. Будет создана при первом запуске.` : 'Существующая ветка. Место работы будет показано при выборе.')

async function finish() {
  if (where.value?.invalid) return
  editing.value = false
  await nextTick()
  toggle.value?.$el.focus({ preventScroll: true })
}
</script>

<style scoped>
.execution-branch { margin-bottom: 12px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.branch-heading { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.branch-icon { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-muted); }
.branch-summary { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.branch-summary h3 { flex-shrink: 0; font-size: 11px; font-weight: 500; color: var(--text-muted); }
.branch-summary code { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text); }
.branch-caption { margin-top: 10px; font-size: 12px; line-height: 1.5; color: var(--text-muted); overflow-wrap: anywhere; }
.branch-fixed { font-size: 11px; color: var(--text-muted); }
.branch-editor { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.branch-editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
.branch-editor-footer span { font-size: 11.5px; color: var(--text-muted); }
</style>
