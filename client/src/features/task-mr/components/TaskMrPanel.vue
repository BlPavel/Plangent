<template>
  <section class="task-mr" :class="{ stacked }" :aria-busy="busy">
    <div v-if="mr || !draft" class="tm-bar">
      <template v-if="mr">
        <span class="tm-label">МР</span>
        <a v-if="safeUrl" class="tm-link" :href="safeUrl" target="_blank" rel="noopener noreferrer" title="Открыть на хостинге">!{{ mr.iid }} ↗</a>
        <span v-else class="tm-link">!{{ mr.iid }}</span>
        <span class="status-badge" :class="badges[mr.state] ?? 'neutral'" role="status">{{ states[mr.state] || mr.state }}</span>
        <button v-if="taskId" type="button" class="tm-action" :disabled="busy" title="Запросить состояние МР на хостинге" @click="refresh">Обновить статус</button>
      </template>
      <span v-else-if="stacked" class="tm-muted">МР для этой ветки ещё нет.</span>
      <span v-else-if="taskId" class="tm-muted">МР ещё не создан</span>
      <span class="tm-spacer" />
      <button v-if="!done && !draft" type="button" class="btn btn-ghost btn-sm" :disabled="busy" title="Превью МР: ветка будет отправлена в origin, если ещё не отправлена" @click="open">{{ busy && !mr ? 'Подготовка…' : 'Создать МР' }}</button>
    </div>
    <div v-if="error" role="alert" class="tm-error">{{ error }} <button type="button" class="tm-x" aria-label="Скрыть" @click="error = ''">✕</button></div>

    <form v-if="draft" class="tm-form" @submit.prevent="create" @keydown.esc.stop.prevent="cancel" @keydown.enter.ctrl.exact.prevent="create" @keydown.enter.meta.exact.prevent="create">
      <div class="tm-head">
        <span class="tm-title">Новый МР</span>
        <span class="tm-muted"><code>{{ draft.source_branch }}</code> → <code>{{ draft.target_branch || '?' }}</code></span>
      </div>
      <label class="tm-field"><span class="tm-name">Целевая ветка</span>
        <select v-model="draft.target_branch" class="control control-sm" :disabled="busy" required>
          <option value="" disabled>Выберите ветку</option>
          <option v-for="name in targets" :key="name" :value="name">{{ name }}</option>
        </select>
        <small v-if="draft.target_branch === draft.source_branch" class="tm-warn">Целевая ветка совпадает с исходной.</small>
      </label>
      <label class="tm-field"><span class="tm-name">Заголовок</span>
        <input v-model="draft.title" class="control control-sm" :disabled="busy" maxlength="1000" required />
      </label>
      <label class="tm-field">
        <span class="tm-name tm-row">Описание <span class="tm-spacer" /><button type="button" class="tm-action" :disabled="busy" @click="describe">✨ {{ generating ? 'Агент пишет…' : 'Предложить' }}</button></span>
        <textarea v-model="draft.description" class="control" :disabled="busy" rows="8" maxlength="100000" :placeholder="generating ? 'Агент готовит черновик описания…' : ''" />
      </label>
      <div class="tm-field">
        <span class="tm-name">Ревьюеры</span>
        <div class="tm-tags">
          <span v-for="value in reviewers" :key="value" class="tm-tag">{{ memberName(value) }}<button type="button" class="tm-x" :aria-label="'Убрать ' + memberName(value)" @click="reviewers = reviewers.filter(r => r !== value)">×</button></span>
          <MemberPicker v-if="members.length" :members="freeMembers" @pick="reviewers = [...reviewers, $event]" />
          <input v-else class="tm-tag-input" :placeholder="reviewers.length ? 'Добавить…' : 'логин или ID, Enter'" @keydown.enter.prevent="addTyped" @blur="addTyped" />
        </div>
        <small>{{ membersNote || 'По умолчанию — из настроек проекта.' }}</small>
      </div>
      <div class="tm-flags">
        <label class="tm-check"><input v-model="draft.remove_source_branch" type="checkbox" :disabled="busy" /> Удалить исходную ветку после слияния</label>
        <label class="tm-check"><input v-model="draft.squash" type="checkbox" :disabled="busy" /> Объединить коммиты при слиянии (squash)</label>
      </div>
      <div class="tm-footer">
        <span class="tm-muted">Перед созданием ветка будет отправлена в origin, если её там нет. Ctrl+Enter — создать.</span>
        <div class="tm-actions">
          <button type="button" class="btn btn-subtle btn-sm" :disabled="busy && !generating" @click="cancel">Отмена</button>
          <button class="btn btn-blue btn-sm" :disabled="busy || !draft.title.trim() || !draft.target_branch.trim() || draft.target_branch === draft.source_branch">Создать МР</button>
        </div>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { Task } from '@core/models'
import MemberPicker from '@shared/ui/MemberPicker.vue'
import { errorText } from '@shared/utils/errorText'
import { taskMrApi } from '../api'
import type { MrPreview, TaskMr } from '../types'

/** The branch's merge request: its status, or a form to create one. `stacked` — laid out for a narrow side column. */
const props = defineProps<{ projectId: string; taskId?: string; stacked?: boolean }>()
type Member = { value: string; login: string; name: string }
const app = useAppStore(), busy = ref(false), generating = ref(false), error = ref(''), draft = ref<MrPreview | null>(null), mr = ref<TaskMr | null>(null), done = ref(false)
const branches = ref<string[]>([]), reviewers = ref<string[]>([]), members = ref<Member[]>([]), membersNote = ref('')
const states: Record<string, string> = { opened: 'Открыт', merged: 'Влит', closed: 'Закрыт', locked: 'Заблокирован' }
const badges: Record<string, string> = { opened: 'open', merged: 'done', closed: 'neutral', locked: 'progress' }
const safeUrl = computed(() => { try { const u = new URL(mr.value?.web_url || ''); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined } catch { return undefined } })
const targets = computed(() => {
  const wanted = draft.value?.target_branch ?? ''
  return wanted && !branches.value.includes(wanted) ? [wanted, ...branches.value] : branches.value
})
const memberName = (value: string) => members.value.find(m => m.value === value)?.name ?? value
const freeMembers = computed(() => members.value.filter(m => !reviewers.value.includes(m.value)))
function addTyped(event: Event) {
  const input = event.target as HTMLInputElement, value = input.value.trim()
  input.value = ''
  if (value && !reviewers.value.includes(value)) reviewers.value = [...reviewers.value, value]
}

let generation = 0
onScopeDispose(() => { generation++ })
async function refresh() {
  if (!props.taskId || busy.value) return
  const mine = generation; busy.value = true; error.value = ''
  try { const result = await taskMrApi.refresh(props.projectId, props.taskId); if (mine === generation) mr.value = result }
  catch (cause) { if (mine === generation) error.value = errorText(cause) }
  finally { if (mine === generation) busy.value = false }
}
watch(() => [props.projectId, props.taskId], async () => {
  const mine = ++generation; draft.value = null; mr.value = null; error.value = ''; busy.value = false; done.value = false
  if (!props.taskId) return
  try {
    const task = await api.get<Task>('/projects/' + encodeURIComponent(props.projectId) + '/tasks/' + encodeURIComponent(props.taskId))
    if (mine !== generation) return
    done.value = task.status === 'done'
    if (task.mr_link) { const link = JSON.parse(task.mr_link) as { iid: number; url: string; state: string }; mr.value = { iid: link.iid, web_url: link.url, state: link.state } }
    if (task.mr_link || task.branch_name) await refresh()
  } catch (cause) { if (mine === generation) error.value = errorText(cause) }
}, { immediate: true })

async function open() {
  if (busy.value) return
  const mine = generation, p = encodeURIComponent(props.projectId); busy.value = true; error.value = ''
  try {
    const [value, list, people] = await Promise.all([
      taskMrApi.preview(props.projectId, props.taskId),
      api.get<{ name: string }[]>('/projects/' + p + '/git/branches'),
      api.get<Member[]>('/projects/' + p + '/host-members').then(m => ({ m, note: '' }), cause => ({ m: [] as Member[], note: 'Список участников недоступен (' + errorText(cause) + ') — введите логин или ID.' })),
    ])
    if (mine !== generation) return
    draft.value = value
    reviewers.value = [...value.reviewer_ids.map(String), ...(value.reviewer_logins ?? [])]
    branches.value = [...new Set(list.map(b => b.name.replace(/^origin\//, '')))].filter(name => name !== 'HEAD' && name !== value.source_branch)
    members.value = people.m; membersNote.value = people.note
  } catch (cause) { if (mine === generation) error.value = errorText(cause) }
  finally { if (mine === generation) busy.value = false }
  if (mine === generation && draft.value) await describe()
}
async function describe() {
  if (!draft.value || busy.value) return
  const mine = generation, value = { ...draft.value }; busy.value = true; generating.value = true; error.value = ''
  try {
    const result = await taskMrApi.describe(props.projectId, value)
    if (mine === generation && draft.value?.head === value.head && draft.value.target_branch === value.target_branch) draft.value.description = result.description
  } catch (cause) { if (mine === generation) error.value = 'Агент не подготовил описание: ' + errorText(cause) + '. Текст можно написать вручную.' }
  finally { if (mine === generation) { busy.value = false; generating.value = false } }
}
async function create() {
  const d = draft.value
  if (!d || busy.value || !d.title.trim() || !d.target_branch.trim() || d.target_branch === d.source_branch) return
  const mine = generation; error.value = ''
  // GitLab knows people by numeric ID, GitHub by login.
  const reviewer_ids = reviewers.value.filter(r => /^\d+$/.test(r)).map(Number)
  const reviewer_logins = reviewers.value.filter(r => !/^\d+$/.test(r))
  busy.value = true
  try {
    if (!await app.confirm('Создать МР «' + d.title + '» из ' + d.source_branch + ' в ' + d.target_branch + '? Необходимые коммиты будут отправлены в origin.', { confirmLabel: 'Создать МР и push' })) return
    if (mine !== generation || !draft.value) return
    const result = await taskMrApi.create(props.projectId, { ...d, title: d.title.trim(), target_branch: d.target_branch.trim(), reviewer_ids, reviewer_logins })
    if (mine === generation) { mr.value = result; draft.value = null; app.toast(props.taskId ? 'МР создан и связан с задачей' : 'МР создан', 'success') }
  } catch (cause) { if (mine === generation) error.value = errorText(cause) }
  finally { if (mine === generation) busy.value = false }
}
async function cancel() {
  if (busy.value && !generating.value) return
  if (!draft.value || await app.confirm('Закрыть превью МР? Несохранённый текст будет потерян.', { confirmLabel: 'Закрыть' })) draft.value = null
}
</script>

<style scoped>
.task-mr { flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; padding: 8px 20px; border-bottom: 1px solid var(--border); font-size: 12.5px; }
.task-mr.stacked { padding: 14px; border-bottom: none; }
.tm-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.tm-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.tm-link { font-weight: 600; color: var(--blue-hover); text-decoration: none; white-space: nowrap; }
.tm-link:hover { text-decoration: underline; }
.tm-muted { font-size: 11.5px; color: var(--text-faint); }
.tm-spacer { flex: 1; }
.tm-action { padding: 0; font: inherit; font-size: 11.5px; font-weight: 400; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.tm-action:hover:not(:disabled) { text-decoration: underline; }
.tm-action:disabled { color: var(--text-faint); cursor: default; }
.tm-error { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; padding: 6px 10px; font-size: 12px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; }
.tm-x { padding: 0 3px; font: inherit; line-height: 1; color: inherit; background: none; border: none; cursor: pointer; }
.tm-form { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
.tm-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.tm-title { font-size: 13px; font-weight: 600; }
.tm-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tm-name { font-size: 12.5px; font-weight: 500; color: var(--text); }
.tm-field small { font-size: 11px; color: var(--text-faint); overflow-wrap: anywhere; }
.tm-row { display: flex; align-items: center; gap: 8px; }
.control { width: 100%; font-size: 13px; }
textarea.control { height: auto; padding: 8px 10px; resize: vertical; line-height: 1.5; }
.tm-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 6px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.tm-tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; font-size: 12px; background: var(--blue-soft); color: var(--blue-hover); border-radius: var(--radius-pill); }
.tm-tag-input { flex: 1; min-width: 90px; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--text); background: none; border: none; }
.tm-tag-input:focus { outline: none; }
.tm-flags { display: flex; flex-direction: column; gap: 8px; }
.tm-check { display: inline-flex; align-items: center; gap: 8px; color: var(--text); cursor: pointer; }
.tm-check input { margin: 0; accent-color: var(--blue); }
.tm-warn { color: var(--warning-text) !important; }
.tm-footer { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.tm-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
