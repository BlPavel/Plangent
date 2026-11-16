<template>
  <section class="finish">
    <div v-if="store.error || localError" role="alert" class="fp-alert">{{ store.error || localError }}</div>

    <form v-if="!store.run || finished" class="fp-form" @submit.prevent="start">
      <p v-if="store.run && finished" class="fp-last">
        Прошлое завершение: {{ statuses[store.run.status] || store.run.status }}<template v-if="store.run.mr_url"> · <a :href="store.run.mr_url" target="_blank" rel="noopener">МР</a></template>
      </p>

      <header class="fp-heading">
        <h2>Завершение работы</h2>
        <p>Выберите, как оформить изменения. Выберите автоматическое завершение или проверку коммитов перед продолжением.</p>
      </header>

      <fieldset class="fp-field fp-scenarios">
        <legend>Сценарий завершения</legend>
        <AppRadioGroup :model-value="options.scenario" :options="scenarioOptions" label="Сценарий завершения" vertical @update:model-value="options.scenario = $event as typeof options.scenario" />
      </fieldset>

      <div class="fp-settings">
        <section class="fp-field fp-card" aria-label="Оформление коммитов">
          <h3 class="fp-label">Оформление коммитов</h3>
          <AppRadioGroup :model-value="options.commitMode" :options="[{ value: 'split', label: 'Разделить по смыслу', hint: 'Агент определит количество коммитов.' }, { value: 'single', label: 'Всё одним коммитом', hint: 'Объединить все изменения.' }]" label="Оформление коммитов" vertical @update:model-value="options.commitMode = $event as 'split' | 'single'" />
          <div class="fp-extras">
            <AppCheckbox v-model="options.includeDescription">Описание в коммитах</AppCheckbox>
            <CoauthorsField v-model="options.coauthors" :known="git.coauthors" />
          </div>
        </section>

        <section class="fp-field fp-card">
          <h3 class="fp-label">Ветки</h3>
          <span class="fp-caption">Рабочая ветка</span>
          <div class="fp-branch">
            <span class="fp-branch-name" :title="branch || branchPlaceholder">⎇ {{ branch || branchPlaceholder }}</span>
            <AppBadge v-if="branch && !published"  title="Ветки ещё нет в origin">локальная</AppBadge>
          </div>
          <div v-if="!workspaceId" class="fp-branch-actions">
            <AppButton v-if="!sameBranch" type="button" size="sm" :aria-expanded="newBranch" @click="newBranch = !newBranch">{{ newBranch ? 'Оставить текущую' : 'Новая ветка' }}</AppButton>
            <AppButton type="button" size="sm" :disabled="!!git.writeBlocked || !git.repository" :aria-expanded="switching" :title="git.writeBlocked || 'Переключиться на существующую ветку'" @click="switching = !switching">{{ switching ? 'Не менять' : 'Сменить ветку' }}</AppButton>
          </div>
          <template v-if="switching && !workspaceId">
            <BranchSelect block :model-value="branch ?? ''" :options="branchOptions" small placeholder="Выберите ветку" label="Переключиться на ветку" :disabled="switchBusy" @update:model-value="switchTo" />
            <small v-if="switchError" role="alert" class="fp-warn">{{ switchError }}</small>
          </template>
          <template v-if="needsBranchName">
            <BranchNameInput v-model="branchName" :prefixes="prefixes" placeholder="ABC-1-short-name" label="Имя новой ветки" />
            <span class="fp-caption">Создать от ветки</span>
            <BranchSelect block v-model="baseBranch" :options="branchOptions" small placeholder="Текущая ветка" label="Создать от ветки" />
          </template>
          <small v-if="sameBranch && workspaceId" class="fp-warn">Ветка работы совпадает с целевой веткой МР: выберите другую цель.</small>
          <small v-else-if="sameBranch">Вы на целевой ветке: коммиты лягут в новую рабочую ветку.</small>
          <small v-else-if="newBranch">Ветка создастся от выбранной ниже (по умолчанию от текущей), коммиты лягут в неё.</small>
          <small v-if="options.scenario !== 'commits' && (!published || newBranch || sameBranch)">При push ветка будет опубликована в origin.</small>

          <div v-if="options.scenario === 'full'" class="fp-field fp-target">
            <span class="fp-caption">Целевая ветка МР</span>
            <BranchSelect block v-model="options.targetBranch" :options="targets.map(name => ({ value: name, label: 'origin/' + name }))" small placeholder="Выберите ветку" label="Целевая ветка МР" />
            <AppButton type="button" size="sm" class="fp-branch-action" :disabled="refreshingBranches" @click="refreshBranches">{{ refreshingBranches ? 'Обновление из origin…' : 'Обновить ветки из origin' }}</AppButton>
            <small v-if="branchesError" role="alert" class="fp-warn">{{ branchesError }}</small>
            <small>{{ mrDefaults }}</small>
          </div>
        </section>
      </div>

      <div class="fp-footer">
        <AppCheckbox :model-value="!!options.autoContinue" @update:model-value="options.autoContinue = $event">
          <span class="fp-auto"><span class="fp-choice-label">Завершить автоматически</span><small>Выполнить выбранный сценарий целиком без подтверждения коммитов и МР.</small></span>
        </AppCheckbox>
        <div class="fp-launch">
          <div class="fp-launch-copy">
            <span class="fp-label">{{ FINISH_SCENARIOS[options.scenario].label }}</span>
            <p>{{ options.autoContinue ? (options.scenario === 'commits' ? 'Коммиты будут созданы локально.' : options.scenario === 'push' ? 'После создания коммитов — push в origin.' : 'После создания коммитов — push и МР в целевую ветку.') : options.scenario === 'commits' ? 'Коммиты останутся локально после вашего подтверждения.' : options.scenario === 'push' ? 'После подтверждения коммиты отправятся в origin.' : 'После подтверждения — push и МР в целевую ветку.' }}</p>
          </div>
          <AppButton type="submit" variant="blue" block :disabled="!canStart" :title="startHint">{{ store.busy ? 'Запуск…' : 'Начать завершение' }}</AppButton>
        </div>
        <p v-if="startHint" class="fp-hint fp-warn" role="status">{{ startHint }}</p>
        <GitAgentNote />
      </div>
      <!-- A work is closed here too: after its МР, or without commits at all. -->
      <div v-if="closable" class="fp-close">
        <p>{{ store.run?.status === 'complete' ? 'Изменения оформлены. Закройте работу: рабочее место уберётся, ветка останется.' : 'Или закройте работу без коммитов: изменения останутся в ветке как есть.' }}</p>
        <AppButton type="button" size="sm" :variant="store.run?.status === 'complete' ? 'blue' : 'subtle'" @click="emit('close')">Закрыть работу</AppButton>
      </div>
    </form>

    <template v-else>
      <ol class="fp-steps" :aria-label="'Этапы: ' + (scenarios[store.run.scenario as keyof typeof scenarios] || store.run.scenario)">
        <li v-for="(stage, index) in stageList" :key="stage" :class="stepState(index)" :aria-current="store.run.stage === stage ? 'step' : undefined">
          <span class="fp-dot">{{ stepState(index) === 'done' ? '✓' : stepState(index) === 'error' ? '!' : index + 1 }}</span>{{ stages[stage] || stage }}
        </li>
      </ol>
      <p class="fp-status">
        <AppBadge dot  :tone="statusBadge">{{ statuses[store.run.status] || store.run.status }}</AppBadge>
        <span class="fp-muted">{{ statusHint }}</span>
      </p>
      <div v-if="store.run.error" role="alert" class="fp-alert">{{ store.run.error }}</div>
      <p v-if="store.run.mr_url" class="fp-mr">МР: <a :href="store.run.mr_url" target="_blank" rel="noopener">{{ store.run.mr_url }}</a></p>

      <div v-if="store.run.stage === 'confirmation'" class="fp-commits">
        <article v-for="(commit, index) in draft" :key="index" class="fp-commit" :class="{ over: dropTarget === index }" @dragover.prevent="dropTarget = index" @dragleave="dropTarget = null" @drop.prevent="drop($event, index)">
          <div class="fp-commit-head">
            <span class="fp-num">{{ index + 1 }}</span>
            <AppInput v-model="commit.title" block size="sm" aria-label="Заголовок коммита" :disabled="!editable" />
          </div>
          <AppTextarea v-if="store.run.options.includeDescription" v-model="commit.body" block aria-label="Описание коммита" rows="2" :disabled="!editable" />
          <div v-for="path in commit.files" :key="path" class="fp-file" :class="{ selected: selected?.path === path }" :draggable="editable" @dragstart="drag($event, index, path)">
            <span v-if="editable" class="fp-grip" title="Перетащите файл в другой коммит">⋮⋮</span>
            <AppButton variant="link" size="sm" type="button"  :title="'Показать diff: ' + path" @click="selected = selected?.path === path ? null : { index, path }">{{ path }}</AppButton>
            <AppSelect v-if="editable && draft.length > 1" :model-value="String(index)" :options="draft.map((other, to) => ({ value: String(to), label: `→ ${to + 1}. ${other.title}` }))" label="Перенести файл в коммит" title="Перенести файл в другой коммит" size="sm" @update:model-value="move(index, Number($event), path)" />
          </div>
          <div v-if="editable && (index > 0 || commit.files.length > 1)" class="fp-commit-actions">
            <AppButton variant="link" size="sm" v-if="index > 0" type="button"  @click="merge(index)">Объединить с предыдущим</AppButton>
            <AppButton variant="link" size="sm" v-if="commit.files.length > 1" type="button"  @click="split(index)">Разделить по файлам</AppButton>
          </div>
        </article>
        <div v-if="selected" class="fp-diff">
          <CommitDiff v-if="selectedCommit?.sha" :project-id="projectId" :path="selected.path" :base="selectedBase" :end="selectedCommit.sha" :original-path="context?.changes.find(c => c.path === selected?.path)?.originalPath" :binary="context?.diffs[selected.path]?.includes('Binary files')" :deleted="context?.changes.find(c => c.path === selected?.path)?.status === 'D'" />
        </div>
      </div>
      <p v-if="dirty" class="fp-hint fp-warn">Diff показывает созданные коммиты. Сохраните состав, чтобы увидеть результат правок.</p>
      <div v-if="store.run.scenario === 'full' && store.run.stage === 'confirmation'" class="fp-mr-draft">
        <span class="fp-label">Merge request</span>
        <AppInput v-model="mrDraft.title" block size="sm" aria-label="Заголовок МР" placeholder="Заголовок МР" :disabled="!editable" />
        <AppTextarea v-model="mrDraft.description" block aria-label="Описание МР" rows="8" placeholder="Описание МР" :disabled="!editable" />
        <small>Создастся после push: {{ store.run.options.targetBranch }} ← {{ store.run.branch }}. Ревьюеров, исполнителей и остальное подставят настройки проекта.</small>
      </div>
      <div v-if="editable" class="fp-actions">
        <AppButton variant="ghost" size="sm" type="button"  :disabled="store.busy || !dirty && !mrDirty && !unsaved" :title="unsaved ? 'Создать коммиты заново' : undefined" @click="save">Сохранить</AppButton>
        <AppButton v-if="skippable" variant="ghost" size="sm" type="button" :disabled="store.busy" title="Создать коммиты, не запуская хуки репозитория" @click="saveWithoutHooks">Закоммитить без хуков</AppButton>
        <span class="fp-spacer" />
        <AppButton variant="blue" size="sm" type="button"  :disabled="store.busy || !!mrProblem" :title="mrProblem" @click="accept">Принять{{ store.run.scenario === 'commits' ? '' : store.run.scenario === 'full' ? ', push и МР' : ' и push' }}</AppButton>
      </div>
      <div v-if="store.run.hook_changes?.length" class="fp-hook">
        <p>Хук репозитория изменил файлы после коммита. Если включить их в коммиты, коммиты пересоздадутся с результатом хука.</p>
        <AppButton variant="blue" size="sm" type="button" :disabled="store.busy" @click="adoptHookChanges">Включить изменения хука в коммиты</AppButton>
      </div>
      <div v-if="editable || store.run.status === 'error' && store.run.stage === 'commits'" class="fp-note">
        <AppTextarea v-model="note" block rows="2" :placeholder="retrying ? 'Замечание агенту для повторной попытки' : (store.run.scenario === 'full' ? 'Попросить агента переделать коммиты или МР' : 'Попросить агента переделать коммиты')" @keydown.enter.ctrl.exact.prevent="askAgent" @keydown.meta.enter.exact.prevent="askAgent" />
        <AppButton variant="ghost" size="sm" type="button"  :disabled="store.busy || !retrying && !note.trim()" :title="retrying ? 'Ctrl+Enter. Замечание необязательно: без него агент просто повторит попытку' : 'Ctrl+Enter'" @click="askAgent">{{ retrying ? 'Повторить' : 'Попросить агента' }}</AppButton>
      </div>
      <div v-if="store.run.status === 'error' || store.run.stage !== 'mr'" class="fp-actions">
        <AppButton variant="ghost" size="sm" v-if="store.run.status === 'error' && store.run.stage === 'push'" type="button"  :disabled="store.busy" @click="accept">Повторить push</AppButton>
        <AppButton variant="ghost" size="sm" v-if="store.run.status === 'error' && store.run.stage === 'mr'" type="button"  :disabled="store.busy" @click="accept">Повторить создание МР</AppButton>
        <span class="fp-spacer" />
        <AppButton variant="ghost" size="sm" v-if="canCancel" type="button" :disabled="store.busy" title="Закрыть завершение, ничего не меняя в git; изменения останутся в рабочей папке" @click="cancelRun">Отменить завершение</AppButton>
        <AppButton variant="danger-ghost" size="sm" v-if="store.run.stage !== 'mr'" type="button"  :disabled="store.busy || store.run.stage === 'push' && store.run.status === 'running'" title="Удалить коммиты этого завершения; изменения останутся в рабочей папке" @click="rollback">Откатить коммиты</AppButton>
      </div>
      <details v-if="store.run.output" class="fp-log"><summary>Журнал git</summary><pre>{{ store.run.output }}</pre></details>
    </template>
  </section>
</template>

<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import { AppCheckbox, AppRadioGroup, AppSelect } from '@shared/ui'
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { tasksEndpoints } from '@features/tasks'
import { finishEndpoints } from '../api'

import { useDraft } from '@core/composables/useDraft'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useAppStore } from '@core/stores/app'
import { CommitDiff, CoauthorsField, GitAgentNote, useGitStore } from '@features/code'
import AppButton from '@shared/ui/AppButton.vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { FINISH_SCENARIOS } from '../finish-scenarios'
import { useFinishStore } from '../stores/finish'
import { finishApi } from '../api'
import { scenarios, stages, statuses, type FinishFormOptions as FinishOptions, type FinishCommit, type FinishContext, type Scenario } from '../types'
import type { Task } from '@contracts'

/** «Завершение работ» in the right column of «Код»: defaults come from the project's git settings, the agent from the settings too. */
/** closable: the finish of a work, which can also just be closed from here. */
const props = defineProps<{ projectId: string; task?: { id: string; key: string } | null; blocked?: string; branch?: string | null; workspaceId?: string; closable?: boolean }>()
const emit = defineEmits<{ attention: []; close: [] }>()
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
const app = useAppStore(), store = useFinishStore(), git = useGitStore()
const localError = ref(''), branchesError = ref(''), refreshingBranches = ref(false)
const scenarioOptions = (['commits', 'push', 'full'] as const).map(value => ({ value, ...FINISH_SCENARIOS[value] }))
const options = useDraft<FinishOptions>(() => `task:${props.task?.id ?? 'project-' + props.projectId}:finish:${props.workspaceId ?? 'main'}:options`, () => ({ scenario: 'commits', autoContinue: true, commitMode: 'split', includeDescription: false, includeCoauthors: false, coauthors: [], targetBranch: '' }))
const switching = ref(false), switchBusy = ref(false), switchError = ref(''), baseBranch = ref('')
const branchOptions = computed(() => git.branches.map(b => ({ value: b.name, label: b.name })))
/** The picked branch becomes the working one: no extra new branch on top of it. */
async function switchTo(name: string) {
  if (!name || name === git.repository?.branch || switchBusy.value) return
  switchBusy.value = true; switchError.value = ''
  try { await git.run('switch', { branch: name }); newBranch.value = false; switching.value = false }
  catch (cause) { switchError.value = message(cause) }
  finally { switchBusy.value = false }
}
const newBranch = ref(false), branchName = useDraft(() => `task:${props.task?.id ?? "project-" + props.projectId}:finish:${props.workspaceId ?? "main"}:branchName`, () => '')
const prefixes = computed(() => git.settings?.branch_prefixes ?? [])
/** A workspace has its own branch: it is published when origin has a branch of that name. */
const published = computed(() => props.workspaceId ? !!props.branch && git.branches.some(b => b.remote && b.name === 'origin/' + props.branch) : !!git.repository?.upstream)
/** Only origin branches can be MR targets; the host API expects their unprefixed names. */
const targets = computed(() => {
  const names = [...new Set(git.branches.filter(b => b.remote).map(b => b.name.replace(/^origin\//, '')))].filter(name => name !== 'HEAD')
  const wanted = options.value.targetBranch
  return wanted && !names.includes(wanted) ? [wanted, ...names] : names
})
const sameBranch = computed(() => !!props.branch && props.branch === options.value.targetBranch.replace(/^origin\//, ''))
const mrDefaults = computed(() => {
  const s = git.settings
  if (!s) return ''
  const parts = [s.mr_reviewers.length ? 'ревьюеры: ' + s.mr_reviewers.length : 'без ревьюеров', s.mr_assignees?.length ? 'исполнители: ' + s.mr_assignees.length : '', s.mr_squash ? 'squash' : '', s.mr_remove_branch ? 'удалить ветку после слияния' : ''].filter(Boolean)
  return 'Из настроек проекта: ' + parts.join(', ') + '. Заголовок и описание напишет агент.'
})
const needsBranchName = computed(() => !props.workspaceId && (newBranch.value || sameBranch.value))
const branchPlaceholder = computed(() => git.repository ? 'Ветка не выбрана' : git.error ? 'Ветка недоступна' : 'Загрузка ветки…')
const startHint = computed(() => props.blocked || (!git.repository ? (git.error || 'Загрузка данных Git…')
  : !git.repository.branch ? 'Git находится вне ветки. Выберите рабочую ветку на вкладке «Код».'
  : !git.repository.head ? 'Для завершения нужен исходный коммит в рабочей ветке.'
  : !git.settings?.agent ? 'Выберите агента для коммитов и МР в настройках'
  : options.value.scenario === 'full' && !options.value.targetBranch ? 'Выберите целевую ветку МР'
  : props.workspaceId && sameBranch.value ? 'Ветка работы совпадает с целевой'
  : needsBranchName.value && (!branchName.value.trim() || branchName.value.endsWith('/')) ? 'Введите имя новой ветки' : ''))
const canStart = computed(() => !store.busy && !startHint.value)

const draft = useDraft<FinishCommit[]>(() => `task:${props.task?.id ?? "project-" + props.projectId}:finish:${props.workspaceId ?? "main"}:draft`, () => []), note = useDraft(() => `task:${props.task?.id ?? "project-" + props.projectId}:finish:${props.workspaceId ?? "main"}:note`, () => ''), selected = ref<{ index: number; path: string } | null>(null), context = ref<FinishContext>()
const dropTarget = ref<number | null>(null)
const finished = computed(() => !!store.run && ['complete', 'cancelled'].includes(store.run.status))
const stageList = computed(() => store.run ? ['branch', 'commits', ...(store.run.options.autoContinue ? [] : ['confirmation']), ...(store.run.scenario === 'commits' ? [] : ['push']), ...(store.run.scenario === 'full' ? ['mr'] : []), 'done'] : [])
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
  if (run.status === 'waiting' && run.stage === 'confirmation') return 'Проверьте коммиты' + (run.scenario === 'full' ? ' и МР' : '') + ': поправьте тексты, перенесите файлы или попросите агента переделать.'
  if (run.status === 'running' && run.stage === 'commits') return run.options.commitMode === 'single' ? 'Агент оформляет коммит…' : 'Агент разбивает изменения на коммиты…'
  if (run.status === 'running' && run.stage === 'push') return 'Отправка в origin…'
  if (run.status === 'running' && run.stage === 'mr') return 'Создание МР…'
  return ''
})
const selectedCommit = computed(() => selected.value ? store.run?.commits.find(c => c.files.includes(selected.value!.path)) : undefined)
const selectedBase = computed(() => {
  const index = store.run?.commits.findIndex(c => c.files.includes(selected.value?.path ?? '')) ?? -1
  return (index > 0 ? store.run?.commits[index - 1]?.sha : store.run?.base_head) ?? 'HEAD'
})
const editable = computed(() => store.run?.stage === 'confirmation' && ['waiting', 'error'].includes(store.run.status))
/** Commits that were proposed but not created (git rejected one): saving recreates them. */
const unsaved = computed(() => !!store.run?.commits.some(commit => !commit.sha))
/** After a failure the agent can simply try again, a note only asks it for changes. */
const retrying = computed(() => store.run?.status === 'error')
/** Skipping the hooks is offered only for a commit that failed, never when a hook changed files (they did run). */
const skippable = computed(() => store.run?.status === 'error' && store.run.stage === 'confirmation' && !store.run.hook_changes?.length)
const canCancel = computed(() => !!store.run && !(['push', 'mr'].includes(store.run.stage) && store.run.status === 'running'))
const clean = (list: FinishCommit[]) => JSON.stringify(list.map(({ files, title, body }) => ({ files, title, body })))
const dirty = computed(() => clean(draft.value) !== clean(store.run?.commits ?? []))
// The MR text of a full cycle is confirmed and edited together with the commits.
const mrDraft = useDraft(() => `task:${props.task?.id ?? "project-" + props.projectId}:finish:${props.workspaceId ?? "main"}:mrDraft`, () => ({ title: '', description: '' }))
const mrDirty = computed(() => store.run?.scenario === 'full' && (mrDraft.value.title !== (store.run.mr_draft?.title ?? '') || mrDraft.value.description !== (store.run.mr_draft?.description ?? '')))
const mrProblem = computed(() => store.run?.scenario === 'full' && store.run.stage === 'confirmation' && (!mrDraft.value.title.trim() || /[\r\n]/.test(mrDraft.value.title)) ? 'Заголовок МР — одна непустая строка' : '')
const mrSource = useDraft(() => `task:${props.task?.id ?? 'project-' + props.projectId}:finish:${props.workspaceId ?? 'main'}:mr-source`, () => ({ initialized: false, text: '' }))
watch(() => store.run?.mr_draft, value => {
  const next = { title: value?.title ?? '', description: value?.description ?? '' }
  if (!mrSource.value.initialized || JSON.stringify(mrDraft.value) === mrSource.value.text) mrDraft.value = next
  mrSource.value = { initialized: true, text: JSON.stringify(next) }
}, { immediate: true })

// The task may pin its own scenario and target; otherwise the project's settings decide.
const taskData = ref<Task | null>(null)
const defaultsApplied = useDraft(() => `task:${props.task?.id ?? 'project-' + props.projectId}:finish:${props.workspaceId ?? 'main'}:defaults`, () => false)
function applyDefaults() {
  if (defaultsApplied.value) return
  const s = git.settings
  if (!s) return
  defaultsApplied.value = true
  const scenario = (taskData.value?.finish_scenario ?? s.finish_scenario) as Scenario
  options.value = {
    ...options.value, scenario: scenario === 'nothing' ? 'commits' : scenario, includeDescription: s.include_description,
    targetBranch: (taskData.value?.target_branch || taskData.value?.base_branch || s.base_branch || ['main', 'master'].find(name => git.branches.some(b => b.name === 'origin/' + name)) || '').replace(/^origin\//, ''),
  }
  branchName.value = (s.branch_prefixes[0] ? s.branch_prefixes[0] + '/' : '') + (props.task?.key ?? '')
}
let generation = 0
onBeforeUnmount(() => { generation++ })
watch(() => [props.projectId, props.task?.id], async () => {
  const mine = ++generation; localError.value = ''; selected.value = null; context.value = undefined; taskData.value = null; newBranch.value = false
  try {
    const p = encodeURIComponent(props.projectId)
    taskData.value = props.task ? await tasksEndpoints.getProjectsByProjectIdTasksByTaskId({ params: { projectId: p, taskId: props.task.id } }) : null
    if (mine !== generation) return
    applyDefaults()
    let id: string | undefined
    if (props.task) { const state = await finishEndpoints.getProjectsByProjectIdFinishTaskByTaskId({ params: { projectId: p, taskId: props.task.id } }); id = state?.id }
    if (mine === generation) await store.load(props.projectId, id, props.workspaceId)
  } catch (cause) { if (mine === generation) localError.value = message(cause) }
}, { immediate: true })
async function refreshBranches() {
  if (refreshingBranches.value) return
  const mine = generation, projectId = props.projectId
  refreshingBranches.value = true; branchesError.value = ''
  try {
    const refs = await git.refreshBranches()
    if (mine === generation && projectId === git.projectId) {
      git.branches = refs
      if (!options.value.targetBranch) options.value.targetBranch = ['main', 'master'].find(name => refs.some(b => b.name === 'origin/' + name)) ?? ''
    }
  } catch (cause) { if (mine === generation) branchesError.value = message(cause) }
  finally { if (mine === generation) refreshingBranches.value = false }
}
watch(() => options.value.scenario, scenario => { if (scenario === 'full') void refreshBranches() }, { immediate: true })
// The git store loads the settings by itself; the form picks them up once they arrive.
watch(() => git.settings, (value, previous) => { if (value && !previous) applyDefaults() })
watch(() => store.run?.commits, (commits, previous) => { if (clean(draft.value) === clean(previous ?? []) || !draft.value.length) draft.value = copy(commits ?? []) }, { deep: true })
// Immediate: without a task the run can be loaded before this watcher is set up.
watch(() => store.run?.id, async id => {
  if (!draft.value.length) draft.value = copy(store.run?.commits ?? [])
  if (!id) return
  try { const value = await finishApi.context(props.projectId, id, props.workspaceId); if (store.run?.id === id) context.value = value } catch (cause) { localError.value = message(cause) }
}, { immediate: true })
// A run that needs the user brings its tab forward.
watch(() => store.run?.status, status => { if (status === 'waiting' || status === 'error') emit('attention') }, { immediate: true })


async function start() {
  if (!canStart.value) return
  try {
    await store.start({ ...options.value, includeCoauthors: options.value.coauthors.length > 0, task_id: props.task?.id, branchName: needsBranchName.value ? branchName.value.trim() : undefined, baseBranch: needsBranchName.value && baseBranch.value ? baseBranch.value : undefined })
    draft.value = copy(store.run?.commits ?? [])
  } catch { /* store error */ }
}
function move(from: number, to: number, path: string) { if (!editable.value || from === to || !draft.value[from]?.files.includes(path) || !draft.value[to]) return; draft.value[from].files = draft.value[from].files.filter(f => f !== path); draft.value[to].files.push(path); draft.value = draft.value.filter(c => c.files.length) }
function drag(event: DragEvent, index: number, path: string) { event.dataTransfer?.setData('application/plangent-file', JSON.stringify({ index, path })) }
function drop(event: DragEvent, to: number) { dropTarget.value = null; try { const data = JSON.parse(event.dataTransfer?.getData('application/plangent-file') || ''); move(data.index, to, data.path) } catch { /* foreign drag */ } }
function merge(index: number) { const c = draft.value[index]; draft.value[index - 1].files.push(...c.files); draft.value.splice(index, 1) }
function split(index: number) { const c = draft.value[index]; draft.value.splice(index, 1, ...c.files.map(path => ({ title: c.title, body: c.body, files: [path] }))) }
async function save() {
  try {
    if (dirty.value || unsaved.value) { await store.save(draft.value.map(({ files, title, body }) => ({ files, title, body }))); draft.value = copy(store.run?.commits ?? []) }
    if (mrDirty.value) await store.saveMr({ title: mrDraft.value.title.trim(), description: mrDraft.value.description })
  } catch { /* store error */ }
}
async function saveWithoutHooks() {
  if (!await app.confirm('Создать коммиты, не запуская хуки репозитория? Проверки команды (формат сообщения, линтеры) будут пропущены.', { confirmLabel: 'Закоммитить без хуков', danger: true })) return
  try {
    await store.save(draft.value.map(({ files, title, body }) => ({ files, title, body })), true)
    draft.value = copy(store.run?.commits ?? [])
    if (mrDirty.value) await store.saveMr({ title: mrDraft.value.title.trim(), description: mrDraft.value.description })
  } catch { /* store error */ }
}
const adoptHookChanges = () => act('adopt-hook-changes')
async function cancelRun() {
  const made = store.run?.commits.some(commit => commit.sha)
  const text = made ? 'Отменить завершение? Созданные коммиты останутся в ветке (чтобы убрать их, нажмите «Откатить коммиты»), изменения файлов не пропадут.'
    : 'Отменить завершение? Git не изменится, изменения останутся в рабочей папке.'
  if (await app.confirm(text, { confirmLabel: 'Отменить завершение', danger: true })) await act('cancel')
}
async function act(name: string, data: object = {}) { try { await store.action(name, data); if (name === 'revise') note.value = '' } catch { /* store error */ } }
function askAgent() { if (!store.busy && (retrying.value || note.value.trim())) void act('revise', { note: note.value }) }
async function accept() {
  if (store.run?.scenario !== 'commits' && !await app.confirm('Принять коммиты, отправить их в origin' + (store.run?.scenario === 'full' ? ' и создать МР?' : '?') + (published.value ? '' : ' Ветка будет опубликована.'), { confirmLabel: store.run?.scenario === 'full' ? 'Принять, push и МР' : 'Принять и push' })) return
  if (dirty.value || mrDirty.value || unsaved.value || store.run?.status === 'error' && store.run.stage === 'confirmation') { await save(); if (store.error) return }
  await act('accept')
}
async function rollback() { if (await app.confirm('Откатить коммиты этого завершения? Изменения файлов останутся в рабочей папке.', { confirmLabel: 'Откатить коммиты', danger: true })) await act('rollback', { confirmed: true }) }
</script>

<style scoped>
.finish { container-type: inline-size; display: flex; flex-direction: column; gap: 14px; padding: 14px; font-size: var(--fs-md); }
.fp-alert { padding: 6px 10px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; white-space: pre-wrap; }
.fp-form { display: flex; flex-direction: column; gap: 16px; }
.fp-last { font-size: var(--fs-sm); color: var(--text-muted); }
.fp-last a, .fp-mr a { color: var(--blue-hover); overflow-wrap: anywhere; }
.fp-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; padding: 0; border: none; }
.fp-field legend, .fp-label { margin-bottom: 2px; padding: 0; font-size: var(--fs-md); font-weight: 500; color: var(--text); }
.fp-field small { font-size: var(--fs-xs); line-height: 1.4; color: var(--text-faint); }
.fp-choice { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.fp-choice input { margin: 2px 0 0; accent-color: var(--blue); }
.fp-choice > span { display: flex; flex-direction: column; gap: 1px; }
.fp-choice-label { color: var(--text); }
.fp-check { display: inline-flex; align-items: center; gap: 8px; color: var(--text); cursor: pointer; }
.fp-check input { margin: 0; accent-color: var(--blue); }
.fp-branch { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fp-branch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.fp-tag { flex-shrink: 0; padding: 0 6px; font-size: var(--fs-xs); color: var(--warning-text); background: var(--warning-soft); border-radius: var(--radius-pill); }
.fp-link { flex-shrink: 0; padding: 0; font: inherit; font-size: var(--fs-sm); color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.fp-link:hover { text-decoration: underline; }
.control { width: 100%; }
textarea.control { height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.fp-footer { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.fp-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fp-spacer { flex: 1; }
.fp-muted { color: var(--text-muted); }
.fp-hint { font-size: var(--fs-sm); color: var(--text-faint); }
.fp-warn { color: var(--warning-text); }
.fp-steps { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; }
.fp-steps li { display: inline-flex; align-items: center; gap: 6px; color: var(--text-faint); }
.fp-dot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-round); border: 1px solid var(--border-strong); }
.fp-steps .done { color: var(--text-muted); } .fp-steps .done .fp-dot { color: var(--accent-hover); border-color: var(--accent-soft); background: var(--accent-soft); }
.fp-steps .current { color: var(--text); font-weight: 600; } .fp-steps .current .fp-dot { color: var(--warning-text); border-color: var(--warning); }
.fp-steps .waiting { color: var(--text); font-weight: 600; } .fp-steps .waiting .fp-dot { color: var(--on-accent); border-color: var(--blue); background: var(--blue); }
.fp-steps .error { color: var(--danger-hover); font-weight: 600; } .fp-steps .error .fp-dot { color: var(--on-accent); border-color: var(--danger); background: var(--danger); }
.fp-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fp-commits { display: flex; flex-direction: column; gap: 8px; }
.fp-commit { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); transition: border-color var(--motion-fast), background var(--motion-fast); }
.fp-commit.over { border-color: var(--blue-hover); background: var(--blue-soft); }
.fp-commit-head { display: flex; align-items: center; gap: 6px; }
.fp-num { flex-shrink: 0; width: 18px; text-align: center; font-weight: 600; color: var(--text-faint); }
.fp-file { display: flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: var(--radius-sm); }
.fp-file.selected { background: var(--blue-soft); }
.fp-grip { cursor: grab; font-size: var(--fs-xs); color: var(--text-faint); user-select: none; }
.fp-path { flex: 1; min-width: 0; padding: 2px 0; font: inherit; font-family: var(--font-mono); font-size: var(--fs-sm); text-align: left; color: var(--text); background: none; border: none; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; }
.fp-path:hover { color: var(--blue-hover); }
.fp-move { max-width: 90px; height: 22px; font: inherit; font-size: var(--fs-xs); color: var(--text-muted); background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.fp-commit-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.fp-diff { height: 360px; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--bg); }
.fp-mr-draft { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.fp-mr-draft small { font-size: var(--fs-xs); color: var(--text-faint); }
.fp-note { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.fp-hook { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.fp-hook p { margin: 0; font-size: var(--fs-sm); color: var(--text-muted); }
.fp-log summary { cursor: pointer; color: var(--text-muted); }
.fp-log pre { margin-top: 6px; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow: auto; font-size: var(--fs-sm); background: var(--bg2); border-radius: var(--radius-sm); }

.fp-heading h2 { margin: 0 0 6px; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -.3px; }
.fp-heading p { color: var(--text-muted); line-height: 1.6; }
.fp-scenarios legend { margin-bottom: 10px; }
.fp-scenario-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.fp-scenario { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 34px 12px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg2); cursor: pointer; transition: border-color var(--motion-modal), background var(--motion-modal); }
.fp-scenario:hover { border-color: var(--border-strong); background: var(--bg3); }
.fp-scenario.active { border-color: var(--blue); background: var(--blue-soft); }
.fp-scenario:has(input:focus-visible) { outline: 2px solid var(--blue-hover); outline-offset: 3px; }
.fp-scenario-top { position: absolute; right: 12px; top: 15px; display: flex; align-items: center; }
.fp-scenario-icon { display: none; }
.fp-scenario.active .fp-scenario-icon { color: var(--blue-hover); background: var(--blue-soft); }
.fp-scenario input { accent-color: var(--blue); }
.fp-scenario .fp-choice-label { font-size: var(--fs-base); font-weight: 600; }
.fp-form small { font-size: var(--fs-sm); line-height: 1.5; color: var(--text-muted); }
.fp-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch; }
.fp-card { padding: 14px; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg2); }
.fp-card .fp-label { font-size: var(--fs-md); font-weight: 600; margin-bottom: 4px; }
.fp-card .fp-choice { padding: 4px 0; }
.fp-choice > span { min-width: 0; gap: 4px; }
.fp-extras { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding-top: 10px; margin-top: 2px; border-top: 1px solid var(--border); }
.fp-caption { font-size: var(--fs-sm); color: var(--text-muted); }
.fp-branch { padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.fp-branch-name { flex: 1; font-family: var(--font-mono); font-size: var(--fs-sm); }
.fp-branch-action { align-self: flex-start; }
.fp-branch-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.fp-target { margin-top: 4px; padding-top: 16px; border-top: 1px solid var(--border); gap: 10px; }
.fp-footer { padding: 14px; gap: 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg2); }
.fp-auto { display: flex; flex-direction: column; gap: 2px; }
.fp-close { display: flex; align-items: center; gap: var(--sp-3); }
.fp-close p { flex: 1; margin: 0; font-size: var(--fs-sm); color: var(--text-muted); }
.fp-launch {display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.fp-launch-copy { min-width: 0; }
.fp-launch-copy p { margin-top: 4px; font-size: var(--fs-sm); color: var(--text-muted); }
.fp-launch > .btn { flex-shrink: 0; }
.fp-form .fp-warn { color: var(--warning-text); }
@container (max-width: 620px) {
  .fp-scenario-grid, .fp-settings { grid-template-columns: 1fr; }
  .fp-scenario { padding: 10px 34px 10px 12px; }
  .fp-heading h2 { font-size: var(--fs-xl); }
}
</style>
