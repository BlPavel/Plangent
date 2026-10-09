<template>
  <section class="finish">
    <button
      type="button" class="btn btn-sm fp-toggle" :class="toggleClass" :aria-expanded="opened"
      :title="store.run && !finished ? 'Показать ход «Завершения работ»' : 'Коммиты, push и МР после ревью'" @click="opened = !opened"
    >
      <template v-if="store.run && !finished">Завершение · {{ stages[store.run.stage] || store.run.stage }}<span class="fp-state">{{ statuses[store.run.status] || store.run.status }}</span></template>
      <template v-else>Завершить работу</template>
      <span class="fp-caret">{{ opened ? '▴' : '▾' }}</span>
    </button>
    <div v-if="opened" class="fp-body git-drawer">
      <div v-if="store.error || localError" role="alert" class="fp-alert">{{ store.error || localError }}</div>

      <form v-if="!store.run || finished" class="fp-start" @submit.prevent="start">
        <div class="fp-grid">
          <label class="fp-field"><span>Сценарий</span>
            <select v-model="options.scenario" class="control control-sm"><option v-for="(label, value) in scenarios" :key="value" :value="value">{{ label }}</option></select>
            <small>{{ SCENARIO_HINTS[options.scenario] }}</small>
          </label>
          <label class="fp-field"><span>Целевая ветка</span>
            <input v-model="options.targetBranch" class="control control-sm" :list="branchList" placeholder="Поиск ветки" />
            <small>Куда пойдёт МР; на ней же работать нельзя — коммиты делаются в рабочей ветке.</small>
          </label>
        </div>
        <datalist :id="branchList"><option v-for="candidate in branches" :key="candidate.ref" :value="candidate.name" /></datalist>
        <label v-if="sameBranch" class="fp-field fp-notice"><span>Вы сейчас на целевой ветке. Коммиты лягут в новую рабочую ветку:</span>
          <input v-model="options.branchName" class="control control-sm" placeholder="feature/task-work" required />
        </label>
        <div class="fp-checks">
          <label class="fp-check"><input v-model="options.includeDescription" type="checkbox" /> Описание в коммитах</label>
          <label class="fp-check"><input v-model="options.includeCoauthors" type="checkbox" /> Соавтор</label>
        </div>
        <div v-if="options.includeCoauthors" class="fp-checks fp-people">
          <label v-for="person in coauthors" :key="person.email" class="fp-check"><input v-model="options.coauthors" type="checkbox" :value="person" /> {{ person.name }} <span class="muted">{{ person.email }}</span></label>
          <span v-if="!coauthors.length" class="muted">Соавторы людей не найдены в истории репозитория.</span>
        </div>
        <div class="fp-actions">
          <span v-if="blocked" class="status-badge progress">{{ blocked }}</span>
          <span v-else-if="options.scenario === 'nothing'" class="fp-hint">Выберите сценарий, чтобы агент сделал коммиты.</span>
          <span class="fp-spacer" />
          <button class="btn btn-primary btn-sm" :disabled="store.busy || !!blocked || options.scenario === 'nothing'">{{ store.busy ? 'Запуск…' : 'Начать завершение' }}</button>
        </div>
      </form>

      <template v-if="store.run">
        <ol class="fp-steps" :aria-label="'Этапы: ' + (scenarios[store.run.scenario as keyof typeof scenarios] || store.run.scenario)">
          <li v-for="(stage, index) in stageList" :key="stage" :class="stepState(index)" :aria-current="store.run.stage === stage ? 'step' : undefined">
            <span class="fp-dot">{{ stepState(index) === 'done' ? '✓' : stepState(index) === 'error' ? '!' : index + 1 }}</span>{{ stages[stage] || stage }}
          </li>
        </ol>
        <p class="fp-status">
          <span class="status-badge" :class="statusBadge">{{ statuses[store.run.status] || store.run.status }}</span>
          <span class="muted">{{ statusHint }}</span>
        </p>
        <div v-if="store.run.error" role="alert" class="fp-alert">{{ store.run.error }}</div>
        <p v-if="store.run.mr_url" class="fp-mr">МР: <a :href="store.run.mr_url" target="_blank" rel="noopener">{{ store.run.mr_url }}</a></p>

        <div v-if="store.run.stage === 'confirmation'" class="fp-confirm">
          <div class="fp-commits">
            <article v-for="(commit, index) in draft" :key="index" class="fp-commit" :class="{ over: dropTarget === index }" @dragover.prevent="dropTarget = index" @dragleave="dropTarget = null" @drop.prevent="drop($event, index)">
              <div class="fp-commit-head">
                <span class="fp-num">{{ index + 1 }}</span>
                <input v-model="commit.title" class="control control-sm" aria-label="Заголовок коммита" :disabled="!editable" />
              </div>
              <textarea v-if="store.run.options.includeDescription" v-model="commit.body" class="control" aria-label="Описание коммита" rows="2" :disabled="!editable" />
              <div v-for="path in commit.files" :key="path" class="fp-file" :class="{ selected: selected?.path === path }" :draggable="editable" @dragstart="drag($event, index, path)">
                <span v-if="editable" class="fp-grip" title="Перетащите файл в другой коммит">⋮⋮</span>
                <button type="button" class="fp-path" :title="'Показать diff: ' + path" @click="selected = { index, path }">{{ path }}</button>
                <select v-if="editable && draft.length > 1" class="fp-move" aria-label="Перенести файл в коммит" title="Перенести файл в другой коммит" :value="index" @change="move(index, Number(($event.target as HTMLSelectElement).value), path)"><option v-for="(other, to) in draft" :key="to" :value="to">→ {{ to + 1 }}. {{ other.title }}</option></select>
              </div>
              <div v-if="editable && (index > 0 || commit.files.length > 1)" class="fp-commit-actions">
                <button v-if="index > 0" type="button" class="btn btn-subtle btn-xs" @click="merge(index)">Объединить с предыдущим</button>
                <button v-if="commit.files.length > 1" type="button" class="btn btn-subtle btn-xs" @click="split(index)">Разделить по файлам</button>
              </div>
            </article>
          </div>
          <div class="fp-diff">
            <CommitDiff v-if="selectedCommit?.sha && selected" :project-id="projectId" :path="selected.path" :base="selectedBase" :end="selectedCommit.sha" :original-path="context?.changes.find(c => c.path === selected?.path)?.originalPath" :binary="context?.diffs[selected.path]?.includes('Binary files')" :deleted="context?.changes.find(c => c.path === selected?.path)?.status === 'D'" />
            <div v-else class="empty-state small">Выберите файл в коммите, чтобы увидеть его diff.</div>
          </div>
        </div>
        <p v-if="dirty" class="fp-hint fp-warn">Diff показывает созданные коммиты. Сохраните состав, чтобы увидеть результат правок.</p>
        <div v-if="editable" class="fp-actions">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="store.busy || !dirty" @click="save">Сохранить состав</button>
          <span class="fp-spacer" />
          <button type="button" class="btn btn-primary btn-sm" :disabled="store.busy" @click="accept">Принять{{ store.run.scenario === 'commits' ? '' : ' и push' }}</button>
        </div>
        <div v-if="editable" class="fp-note">
          <textarea v-model="note" class="control" rows="2" placeholder="Попросить агента переделать коммиты" @keydown.enter.ctrl.exact.prevent="askAgent" @keydown.enter.meta.exact.prevent="askAgent" />
          <button type="button" class="btn btn-ghost btn-sm" :disabled="store.busy || !note.trim()" title="Ctrl+Enter" @click="askAgent">Попросить агента</button>
        </div>
        <div v-if="store.run.status === 'error' && store.run.stage === 'commits'" class="fp-note">
          <textarea v-model="note" class="control" rows="2" placeholder="Замечание агенту для повторной попытки" @keydown.enter.ctrl.exact.prevent="askAgent" @keydown.enter.meta.exact.prevent="askAgent" />
          <button type="button" class="btn btn-ghost btn-sm" :disabled="store.busy || !note.trim()" @click="act('revise', { note })">Повторить с замечанием</button>
        </div>
        <div v-if="store.run.status === 'error' || !finished && store.run.stage !== 'mr'" class="fp-actions">
          <button v-if="store.run.status === 'error' && store.run.stage === 'push'" type="button" class="btn btn-ghost btn-sm" :disabled="store.busy" @click="accept">Повторить push</button>
          <button v-if="store.run.status === 'error' && store.run.stage === 'mr'" type="button" class="btn btn-ghost btn-sm" :disabled="store.busy" @click="accept">Повторить создание МР</button>
          <span class="fp-spacer" />
          <button v-if="!finished && store.run.stage !== 'mr'" type="button" class="btn btn-danger-ghost btn-sm" :disabled="store.busy || store.run.stage === 'push' && store.run.status === 'running'" title="Удалить коммиты этого завершения; изменения останутся в рабочей папке" @click="rollback">Откатить коммиты</button>
        </div>
        <details v-if="store.run.output" class="fp-log"><summary>Журнал git</summary><pre>{{ store.run.output }}</pre></details>
        <details v-if="store.run.session_id" class="fp-log" :open="chatOpen" @toggle="chatOpen = ($event.target as HTMLDetailsElement).open">
          <summary>Чат с агентом-коммитером</summary>
          <div v-if="chatOpen" class="fp-chat"><ChatView :key="store.run.session_id" :session-id="store.run.session_id" /></div>
        </details>
      </template>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { ChatView } from '@features/agent-chat'
import { CommitDiff, gitApi, type GitBranch, type Coauthor } from '@features/code'
import { useFinishStore } from '../stores/finish'
import { finishApi } from '../api'
import { scenarios, stages, statuses, type FinishOptions, type FinishCommit, type FinishContext } from '../types'
import type { Task, ProjectGitSettings } from '@core/models'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
const SCENARIO_HINTS: Record<string, string> = {
  nothing: 'Plangent ничего не коммитит — изменения остаются в рабочей папке.',
  commits: 'Агент разобьёт изменения на коммиты, вы подтвердите их. Без push.',
  push: 'Коммиты агента, ваше подтверждение, затем push в origin.',
  full: 'Коммиты, подтверждение, push и МР в целевую ветку.',
}
const props = defineProps<{ projectId: string; task?: { id: string; key: string } | null; blocked?: string; branch?: string | null }>()
const route = useRoute(), app = useAppStore(), store = useFinishStore()
const opened = ref(route.query.finish === '1'), branches = ref<GitBranch[]>([]), coauthors = ref<Coauthor[]>([]), localError = ref('')
const options = ref<FinishOptions>({ scenario: 'nothing', includeDescription: false, includeCoauthors: false, coauthors: [], targetBranch: '' })
const branchList = computed(() => 'finish-branches-' + props.projectId)
const sameBranch = computed(() => props.branch === options.value.targetBranch.replace(/^origin\//, ''))
const draft = ref<FinishCommit[]>([]), note = ref(''), selected = ref<{ index: number; path: string } | null>(null), context = ref<FinishContext>()
const dropTarget = ref<number | null>(null), chatOpen = ref(true)
const finished = computed(() => !!store.run && ['complete', 'cancelled'].includes(store.run.status))
const stageList = computed(() => store.run ? ['branch', 'commits', 'confirmation', ...(store.run.scenario === 'commits' ? [] : ['push']), ...(store.run.scenario === 'full' ? ['mr'] : []), 'done'] : [])
function stepState(index: number) {
  const run = store.run!, current = stageList.value.indexOf(run.stage)
  if (run.status === 'complete' || index < current) return 'done'
  if (index > current) return 'pending'
  return run.status === 'error' ? 'error' : run.status === 'waiting' ? 'waiting' : run.status === 'cancelled' ? 'pending' : 'current'
}
const statusBadge = computed(() => ({ running: 'progress', waiting: 'open', error: 'danger', complete: 'done' } as Record<string, string>)[store.run?.status ?? ''] ?? 'neutral')
const statusHint = computed(() => {
  const run = store.run
  if (!run) return ''
  if (run.status === 'waiting' && run.stage === 'confirmation') return 'Проверьте коммиты: поправьте заголовки, перенесите файлы или попросите агента переделать.'
  if (run.status === 'running' && run.stage === 'commits') return 'Агент разбивает изменения на коммиты…'
  if (run.status === 'running' && run.stage === 'push') return 'Отправка в origin…'
  if (run.status === 'running' && run.stage === 'mr') return 'Агент готовит заголовок и описание МР…'
  if (run.status === 'complete') return run.pushed ? 'Коммиты отправлены в origin.' : 'Коммиты созданы локально.'
  if (run.status === 'cancelled') return 'Завершение отменено.'
  return ''
})
const toggleClass = computed(() => !store.run || finished.value ? 'btn-ghost' : store.run.status === 'error' ? 'btn-danger-ghost' : store.run.status === 'waiting' ? 'btn-update' : 'btn-ghost')
const selectedCommit = computed(() => selected.value ? store.run?.commits.find(c => c.files.includes(selected.value!.path)) : undefined)
const selectedBase = computed(() => {
 const index = store.run?.commits.findIndex(c => c.files.includes(selected.value?.path ?? '')) ?? -1
 return (index > 0 ? store.run?.commits[index - 1]?.sha : store.run?.base_head) ?? 'HEAD'
})
const editable = computed(() => store.run?.stage === 'confirmation' && ['waiting', 'error'].includes(store.run.status))
const dirty = computed(() => JSON.stringify(draft.value.map(({ files, title, body }) => ({ files, title, body }))) !== JSON.stringify((store.run?.commits ?? []).map(({ files, title, body }) => ({ files, title, body }))))
let generation = 0
onBeforeUnmount(() => { generation++ })
watch(() => [props.projectId, props.task?.id], async () => {
 const mine = ++generation; localError.value = ''; selected.value = null; context.value = undefined
 try {
  const [prefs, task, bs, cs] = await Promise.all([
   api.get<{ values: ProjectGitSettings }>('/projects/' + encodeURIComponent(props.projectId) + '/git-settings'),
   props.task ? api.get<Task>('/projects/' + encodeURIComponent(props.projectId) + '/tasks/' + encodeURIComponent(props.task.id)) : Promise.resolve(null),
   gitApi.branches(props.projectId), gitApi.coauthors(props.projectId),
  ])
  if (mine !== generation) return
  options.value = { ...options.value, scenario: task?.finish_scenario ?? prefs.values.finish_scenario ?? 'nothing', targetBranch: task?.target_branch || task?.base_branch || prefs.values.mr_target_branch || prefs.values.base_branch || '', branchName: prefs.values.branch_template?.replaceAll('{key}', props.task?.key ?? 'work').replaceAll('{slug}', 'work'), includeDescription: prefs.values.include_description ?? false, includeCoauthors: false, coauthors: [] }
  branches.value = bs; coauthors.value = cs
  let id: string | undefined
  if (props.task) { const state = await api.get<{ id: string } | null>('/projects/' + encodeURIComponent(props.projectId) + '/finish/task/' + encodeURIComponent(props.task.id)); id = state?.id }
  if (mine === generation) await store.load(props.projectId, id)
 } catch (cause) { if (mine === generation) localError.value = message(cause) }
}, { immediate: true })
watch(() => store.run?.commits, (commits, previous) => { const clean = (list: FinishCommit[]) => JSON.stringify(list.map(({ files, title, body }) => ({ files, title, body }))); if (clean(draft.value) === clean(previous ?? []) || !draft.value.length) draft.value = copy(commits ?? []) }, { deep: true })
watch(() => store.run?.id, async id => {
 draft.value = copy(store.run?.commits ?? [])
 if (!id) return
 try { const value = await finishApi.context(props.projectId, id); if (store.run?.id === id) context.value = value } catch (cause) { localError.value = message(cause) }
})
// A run that needs the user opens the panel by itself.
watch(() => store.run?.status, status => { if (status === 'waiting' || status === 'error') opened.value = true })
async function start() { try { await store.start({ ...options.value, task_id: props.task?.id, branchName: sameBranch.value ? options.value.branchName : undefined }); draft.value = copy(store.run?.commits ?? []) } catch { /* store error */ } }
function move(from: number, to: number, path: string) { if (!editable.value || from === to || !draft.value[from]?.files.includes(path) || !draft.value[to]) return; draft.value[from].files = draft.value[from].files.filter(f => f !== path); draft.value[to].files.push(path); draft.value = draft.value.filter(c => c.files.length) }
function drag(event: DragEvent, index: number, path: string) { event.dataTransfer?.setData('application/plangent-file', JSON.stringify({ index, path })) }
function drop(event: DragEvent, to: number) { dropTarget.value = null; try { const data = JSON.parse(event.dataTransfer?.getData('application/plangent-file') || ''); move(data.index, to, data.path) } catch { /* foreign drag */ } }
function merge(index: number) { const c = draft.value[index]; draft.value[index - 1].files.push(...c.files); draft.value.splice(index, 1) }
function split(index: number) { const c = draft.value[index]; draft.value.splice(index, 1, ...c.files.map(path => ({ title: c.title, body: c.body, files: [path] }))) }
async function save() { try { await store.save(draft.value.map(({ files, title, body }) => ({ files, title, body }))); draft.value = copy(store.run?.commits ?? []) } catch { /* store error */ } }
async function act(name: string, data: object = {}) { try { await store.action(name, data); if (name === 'revise') note.value = '' } catch { /* store error */ } }
function askAgent() { if (!store.busy && note.value.trim()) void act('revise', { note: note.value }) }
async function accept() {
 if (store.run?.scenario !== 'commits' && !await app.confirm('Принять коммиты и отправить их в origin?', { confirmLabel: 'Принять и push' })) return
 if (dirty.value || store.run?.status === 'error' && store.run.stage === 'confirmation') { await save(); if (store.error) return }
 await act('accept')
}
async function rollback() { if (await app.confirm('Откатить коммиты этого завершения? Изменения файлов останутся в рабочей папке.', { confirmLabel: 'Откатить коммиты', danger: true })) await act('rollback', { confirmed: true }) }
</script>
<style scoped>
.finish { display: flex; flex-direction: column; gap: 8px; padding: 8px 20px; border-bottom: 1px solid var(--border); }
.fp-toggle { gap: 6px; }
.fp-state { margin-left: 4px; font-weight: 400; opacity: .85; }
.fp-caret { font-size: 10px; opacity: .7; }
.fp-body { display: flex; flex-direction: column; gap: 10px; max-height: 70vh; overflow: auto; padding: 12px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg2); }
.fp-alert { padding: 6px 10px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; white-space: pre-wrap; }
.fp-start { display: flex; flex-direction: column; gap: 10px; }
.fp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.fp-field { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); }
.fp-field small { font-size: 11px; color: var(--text-faint); line-height: 1.4; }
.fp-notice { padding: 8px 10px; border: 1px solid var(--warning-soft); border-radius: var(--radius-sm); background: var(--warning-soft); color: var(--warning-text); }
.fp-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.fp-people { padding-left: 20px; }
.fp-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.fp-check input { margin: 0; accent-color: var(--blue); }
.fp-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fp-spacer { flex: 1; }
.fp-hint { font-size: 11.5px; color: var(--text-faint); }
.fp-warn { color: var(--warning-text); }
.fp-steps { display: flex; flex-wrap: wrap; gap: 4px 18px; list-style: none; }
.fp-steps li { display: inline-flex; align-items: center; gap: 6px; color: var(--text-faint); }
.fp-dot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; font-size: 10px; font-weight: 600; border-radius: 50%; border: 1px solid var(--border-strong); }
.fp-steps .done { color: var(--text-muted); } .fp-steps .done .fp-dot { color: var(--accent-hover); border-color: var(--accent-soft); background: var(--accent-soft); }
.fp-steps .current { color: var(--text); font-weight: 600; } .fp-steps .current .fp-dot { color: var(--warning-text); border-color: var(--warning); }
.fp-steps .waiting { color: var(--text); font-weight: 600; } .fp-steps .waiting .fp-dot { color: #fff; border-color: var(--blue); background: var(--blue); }
.fp-steps .error { color: var(--danger-hover); font-weight: 600; } .fp-steps .error .fp-dot { color: #fff; border-color: var(--danger); background: var(--danger); }
.fp-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fp-mr a { color: var(--blue-hover); overflow-wrap: anywhere; }
.fp-confirm { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 2fr); gap: 12px; min-height: 0; }
.fp-commits { display: flex; flex-direction: column; gap: 8px; max-height: 440px; overflow: auto; }
.fp-commit { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); transition: border-color .12s, background .12s; }
.fp-commit.over { border-color: var(--blue-hover); background: var(--blue-soft); }
.fp-commit-head { display: flex; align-items: center; gap: 6px; }
.fp-num { flex-shrink: 0; width: 18px; text-align: center; font-weight: 600; color: var(--text-faint); }
.fp-commit .control { width: 100%; }
textarea.control { height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.fp-file { display: flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: var(--radius-sm); }
.fp-file.selected { background: var(--blue-soft); }
.fp-grip { cursor: grab; font-size: 10px; color: var(--text-faint); user-select: none; }
.fp-path { flex: 1; min-width: 0; padding: 2px 0; font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-path:hover { color: var(--blue-hover); }
.fp-move { max-width: 110px; height: 22px; font: inherit; font-size: 11px; color: var(--text-muted); background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.fp-commit-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.fp-diff { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--bg); }
.fp-note { display: flex; gap: 8px; align-items: flex-start; }
.fp-note textarea { flex: 1; min-width: 0; }
.fp-log summary { cursor: pointer; color: var(--text-muted); }
.fp-log pre { margin-top: 6px; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow: auto; font-size: 11.5px; background: var(--bg); border-radius: var(--radius-sm); }
.fp-chat { height: 420px; margin-top: 6px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
</style>
