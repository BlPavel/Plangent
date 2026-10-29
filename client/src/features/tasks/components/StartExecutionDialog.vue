<template>
  <AppModal :model-value="modelValue" title="Начать выполнение" :confirm-label="busy ? 'Готовим рабочее место…' : failed ? 'Повторить' : 'Начать выполнение'" @update:model-value="!busy && $emit('update:modelValue', $event)" @confirm="!busy && submit()">
    <p v-if="busy" role="status">Готовлю рабочее место…</p>
    <template v-if="ordinary && !failed">
      <div class="place-heading"><strong>Ветка выполнения</strong><span>Проверьте ветку перед запуском. После первого запуска она закрепится за задачей.</span></div>
      <fieldset class="place-picker" :disabled="busy">
        <WhereToWork ref="where" v-model="place" :project-id="task.project_id" ordinary inline :taken="taken" />
      </fieldset>
    </template>
    <template v-else-if="ordinary">
      <label class="field">
        <span>Базовая ветка</span>
        <BranchSelect v-model="base" :options="options" :disabled="busy || failed" placeholder="Из настроек проекта" label="Базовая ветка" />
        <small>Рабочее место создаётся от свежей origin/{{ base || '…' }}. Основная папка проекта не трогается.</small>
      </label>
      <label class="field">
        <span>Ветка работы</span>
        <BranchNameInput v-model="branch" :prefixes="prefixes" :disabled="busy || failed" placeholder="Название подставит Plangent" label="Ветка работы" />
      </label>
    </template>
    <p v-else class="note">{{ workspace ? 'Работа продолжится в своём рабочем месте на ветке ' + workspace.branch + '.' : group ? 'Работа пойдёт в основных папках проектов группы.' : 'Работа продолжится в основной папке проекта.' }}</p>
    <label class="check"><input v-model="review" type="checkbox" :disabled="busy" /> Ревью агентом: авто (в конце очереди)</label>
    <div v-if="failed || error" class="failure" role="alert">
      <strong>Не удалось подготовить рабочее место.</strong>
      <p v-if="error">{{ error }}</p>
      <pre v-if="workspace?.setup_log">{{ workspace.setup_log }}</pre>
      <p v-if="workspace?.error && workspace.error !== error">{{ workspace.error }}</p>
      <small>Очередь не запускалась. Исправьте причину (например, команду подготовки в настройках проекта) и повторите.</small>
    </div>
  </AppModal>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Task, Workspace } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { slug } from '@shared/utils/slug'
import { gitApi } from '@features/code'
import WhereToWork, { type WorkPlace } from './WhereToWork.vue'
import { useWorkStore } from '../stores/work'

const props = defineProps<{ modelValue: boolean; place?: WorkPlace; task: Task; ordinary: boolean; group?: boolean; busy?: boolean; error?: string; workspace?: Workspace | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'update:place': [value: WorkPlace]; start: [{ base_branch: string; branch_name: string; auto_review: boolean; place?: 'new' | 'existing'; branch?: string }] }>()
const base = ref(props.task.base_branch ?? ''), branch = ref(props.task.branch_name ?? ''), review = ref(props.task.auto_review)
const remote = ref<string[]>([]), prefixes = ref<string[]>([])
const work = useWorkStore()
const where = ref<InstanceType<typeof WhereToWork>>()
const localPlace = ref<WorkPlace>({ place: 'new', branch_name: props.task.branch_name || slug(props.task.external_key || props.task.title || props.task.key), base_branch: props.task.base_branch || '', branch: '' })
const place = computed({ get: () => props.place ?? localPlace.value, set: (value: WorkPlace) => { localPlace.value = value; emit('update:place', value) } })
const taken = computed(() => Object.fromEntries(work.entries.filter(e => e.task.project_id === props.task.project_id && e.task.id !== props.task.id && e.workspace && e.workspace.status !== 'removed' && !e.task.closed_at).map(e => [e.workspace!.branch, e.task.title || e.task.key])))
const failed = computed(() => props.workspace?.status === 'failed')
const options = computed(() => remote.value.map(name => ({ value: name, label: 'origin/' + name })))

// A failed workspace keeps the choice it was created with; a new start offers the project's defaults.
watch(() => props.workspace, workspace => { if (workspace) { base.value = workspace.base_branch; branch.value = workspace.branch } }, { immediate: true })
watch(() => [props.ordinary, props.task.project_id], async () => {
  if (!props.ordinary) return
  try {
    const [refs, settings] = await Promise.all([gitApi.branches(props.task.project_id), gitApi.settings(props.task.project_id)])
    remote.value = [...new Set(refs.filter(b => b.remote).map(b => b.name.replace(/^origin\//, '')))].filter(name => name !== 'HEAD')
    prefixes.value = settings.branch_prefixes
    if (settings.auto_review && !props.task.auto_review) review.value = true
    if (!base.value) base.value = settings.base_branch || ['main', 'master'].find(name => remote.value.includes(name)) || ''
    if (!branch.value) branch.value = (settings.branch_prefixes[0] ? settings.branch_prefixes[0] + '/' : '') + slug(props.task.external_key || props.task.title || props.task.key)
  } catch { /* the form stays usable: Plangent falls back to the project's settings */ }
}, { immediate: true })

function submit() {
  if (props.ordinary && !failed.value) {
    if (where.value?.invalid) { where.value.openPicker(); return }
    emit('start', { ...place.value, auto_review: review.value })
    return
  }
  emit('start', { base_branch: base.value, branch_name: branch.value.endsWith('/') ? '' : branch.value, auto_review: review.value })
}
</script>
<style scoped>
.place-heading { display: flex; flex-direction: column; gap: 4px; }
.place-heading strong { font-size: 13px; font-weight: 500; }
.place-heading span { font-size: 12px; color: var(--text-muted); }
.place-picker { min-width: 0; padding: 0; border: 0; }
.place-picker:disabled { opacity: .6; pointer-events: none; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field small, .note { font-size: 11.5px; color: var(--text-muted); }
.check { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.failure { margin-top: 12px; padding: 10px; border: 1px solid var(--danger-hover); border-radius: var(--radius-sm); font-size: 12.5px; }
.failure pre { max-height: 200px; overflow: auto; margin: 8px 0; padding: 8px; background: var(--bg3); font-size: 11.5px; white-space: pre-wrap; }
</style>
