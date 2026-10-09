<template>
  <section class="task-finish" :class="{ attention: state?.status === 'waiting' || state?.status === 'error' }">
    <div class="tf-head">
      <span class="section-label">Завершение работ</span>
      <span v-if="state" class="status-badge" :class="badge">{{ (stageNames[state.stage] || state.stage) + ' · ' + (statusNames[state.status] || state.status) }}</span>
      <span class="tf-spacer" />
      <button type="button" class="btn btn-sm" :class="state?.status === 'waiting' || state?.status === 'error' ? 'btn-blue' : 'btn-ghost'" @click="open">{{ state && !finished ? 'Открыть в «Коде»' : 'Завершить в «Коде»' }}</button>
    </div>
    <p v-if="!state" class="tf-hint">После ревью в табе «Код» запустите «Завершить работу»: агент сделает коммиты по сценарию ниже.</p>
    <div class="tf-grid">
      <label><span>Сценарий</span>
        <select v-model="scenario" class="control control-sm" :disabled="busy" @change="save"><option value="">Из настроек · {{ labels[defaults.finish_scenario || 'nothing'] }}</option><option v-for="(label, value) in labels" :key="value" :value="value">{{ label }}</option></select>
      </label>
      <label><span>Целевая ветка МР</span>
        <input v-model="target" class="control control-sm" list="task-finish-branches" :placeholder="defaults.mr_target_branch || defaults.base_branch || 'Из настроек'" :disabled="busy" @change="save" />
      </label>
    </div>
    <datalist id="task-finish-branches"><option v-for="branch in branches" :key="branch.ref" :value="branch.name" /></datalist>
    <p v-if="error || state?.error" role="alert" class="tf-error">{{ error || state?.error }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import type { Task, ProjectGitSettings } from '@core/models'
import { codeTarget, gitApi, type GitBranch } from '@features/code'
import { errorText } from '@shared/utils/errorText'
const props = defineProps<{ projectId: string; task: Task }>()
const labels = { nothing: 'Ничего', commits: 'Только коммиты', push: 'Коммиты и push', full: 'Полный цикл' }
const stageNames: Record<string, string> = { branch: 'Ветка', commits: 'Коммиты', confirmation: 'Подтверждение', push: 'Push', mr: 'МР', done: 'Готово' }
const statusNames: Record<string, string> = { running: 'В работе', waiting: 'Ждёт подтверждения', error: 'Ошибка', complete: 'Выполнено', cancelled: 'Отменено' }
const router = useRouter(), scenario = ref(''), target = ref(''), busy = ref(false), error = ref('')
const defaults = ref<ProjectGitSettings>({}), branches = ref<GitBranch[]>([])
const state = ref<{ id: string; stage: string; status: string; error: string } | null>(null)
const finished = computed(() => !!state.value && ['complete', 'cancelled'].includes(state.value.status))
const badge = computed(() => ({ running: 'progress', waiting: 'open', error: 'danger', complete: 'done' } as Record<string, string>)[state.value?.status ?? ''] ?? 'neutral')
let generation = 0
async function refresh() {
 const mine = ++generation, p = encodeURIComponent(props.projectId), t = encodeURIComponent(props.task.id)
 try {
  const [settings, finish, bs] = await Promise.all([api.get<{ values: ProjectGitSettings }>('/projects/' + p + '/git-settings'), api.get<typeof state.value>('/projects/' + p + '/finish/task/' + t), gitApi.branches(props.projectId)])
  if (mine === generation) { defaults.value = settings.values; state.value = finish; branches.value = bs; error.value = '' }
 } catch (cause) { if (mine === generation) error.value = errorText(cause) }
}
watch(() => props.task.id, () => { scenario.value = props.task.finish_scenario ?? ''; target.value = props.task.target_branch ?? props.task.base_branch ?? ''; void refresh() }, { immediate: true })
const stop = onServerEvent<{ type: string; projectId?: string }>(event => { if (event.type === 'finish:changed' && event.projectId === props.projectId || event.type === 'events:connected') void refresh() })
onScopeDispose(() => { generation++; stop() })
async function save() {
 busy.value = true; error.value = ''
 try { await api.patch('/projects/' + encodeURIComponent(props.projectId) + '/tasks/' + encodeURIComponent(props.task.id), { finish_scenario: scenario.value || null, target_branch: target.value.trim() || null }) }
 catch (cause) { error.value = errorText(cause) } finally { busy.value = false }
}
function open() { void router.push(codeTarget(props.projectId, props.task) + '&finish=1') }
</script>
<style scoped>
.task-finish { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.task-finish.attention { border-color: var(--blue); }
.tf-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: var(--size-xs); }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.tf-spacer { flex: 1; }
.tf-hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.45; }
.tf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); min-width: 0; }
.control { width: 100%; }
.tf-error { font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; }
</style>
