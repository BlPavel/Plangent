<template>
  <section class="review-tab" :aria-busy="busy">
    <div v-if="error" role="alert" class="rt-alert">{{ error }} <button type="button" class="btn btn-subtle btn-xs" aria-label="Скрыть" @click="error = ''">✕</button></div>
    <template v-if="!detail">
      <div class="rt-entry" :class="{ listing: screen.entry === 'mr' }">
        <div class="rt-title">
          <h2>Ревью</h2>
          <span class="muted">Откройте МР коллеги: читайте код, разбирайте его с агентом и публикуйте замечания в GitLab. Код агент не меняет.</span>
        </div>
        <div class="rt-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="screen.entry === 'mr'" :class="{ on: screen.entry === 'mr' }" @click="screen.entry = 'mr'">Открытые МР</button>
          <button type="button" role="tab" :aria-selected="screen.entry === 'branch'" :class="{ on: screen.entry === 'branch' }" @click="screen.entry = 'branch'">Ветка вручную</button>
        </div>
        <MrList v-if="screen.entry === 'mr'" :screen-key="props.projectId" :items="screen.mrs?.items ?? []" :errors="screen.mrs?.errors ?? []" :loading="loadingMrs" :opening="opening" @open="openMr" @refresh="loadMrs" />
        <template v-else>
          <label v-if="isGroup" class="rt-pick">Проект группы
            <PlainSelect :model-value="memberId" :options="(members ?? []).map(m => ({ value: m.id, label: m.name }))" small placeholder="Выберите проект" label="Проект группы" @update:model-value="memberId = $event; reset()" />
          </label>
          <div v-if="!scope" class="empty-state small">Выберите проект, чтобы посмотреть ветку.</div>
          <form v-else class="rt-form" @submit.prevent="open">
            <span class="muted">Без МР замечания не публикуются: их можно скопировать и вставить на хостинге (так работает и с GitHub).</span>
            <label>Ветка для ревью
              <BranchSelect v-model="branch" :options="branchOptions" placeholder="Выберите ветку" label="Ветка для ревью" :disabled="busy" />
            </label>
            <label>Сравнить с
              <BranchSelect v-model="baseRef" :options="branchOptions" placeholder="Выберите ветку" label="Сравнить с" :disabled="busy" />
            </label>
            <div class="rt-row">
              <button class="btn btn-blue" :disabled="busy || !branch || !baseRef">Открыть ревью</button>
              <button type="button" class="btn btn-subtle" :disabled="busy" title="git fetch origin: подтянуть новые ветки и коммиты" @click="fetchAll">{{ busy ? 'Загрузка…' : 'Подтянуть с origin' }}</button>
            </div>
            <div v-if="!busy && !list.length" class="empty-state small">Веток нет. Нажмите «Подтянуть с origin».</div>
          </form>
        </template>
      </div>
    </template>
    <template v-else>
      <header class="rt-head">
        <div class="rt-row">
          <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="back">← К списку</button>
          <h3 v-if="info" class="rt-mr">
            <a :href="info.mr.web_url" target="_blank" rel="noopener" title="Открыть МР в GitLab">!{{ info.mr.iid }}</a> {{ info.mr.title }}
            <span class="muted">· {{ info.mr.author.name || info.mr.author.username }} · <code>{{ info.mr.source_branch }}</code> → <code>{{ info.mr.target_branch }}</code></span>
          </h3>
          <h3 v-else><code>{{ detail.review.branch_name }}</code> <span class="muted">→ сравнение с</span> <code>{{ detail.review.base_name }}</code></h3>
          <span class="rt-spacer" />
          <template v-if="info">
            <span class="rt-approvals" :class="{ mine: info.approvals?.mine }" :title="approvalsTitle">{{ approvalsText }}</span>
            <AppButton size="sm" :variant="info.approvals?.mine ? 'ghost' : 'blue'" :disabled="busy || headBehind" :title="headBehind ? 'Сначала подтяните новые коммиты МР' : info.approvals?.mine ? 'Снять ваш аппрув в GitLab' : 'Аппрувнуть МР в GitLab на просмотренной версии'" @click="approve(!info.approvals?.mine)">{{ info.approvals?.mine ? 'Снять аппрув' : 'Аппрув' }}</AppButton>
          </template>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" title="git fetch origin и пересчёт изменений" @click="refresh">{{ busy ? 'Загрузка…' : 'Подтянуть изменения' }}</button>
          <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" title="Закрыть агента и удалить копию кода для него; замечания и чаты останутся" @click="finish">Завершить</button>
        </div>
        <div class="rt-row rt-meta">
          <span>Коммитов: {{ detail.commit_count }} · файлов: {{ detail.files.length }}</span>
          <span v-if="headBehind" class="status-badge progress" title="Локальная копия отстаёт от МР">В МР новые коммиты: подтяните изменения</span>
          <span class="rt-spacer" />
          <span v-if="detail.rewritten" class="status-badge progress" title="История ветки была переписана (force-push)">История ветки переписана</span>
          <template v-if="detail.new_commits">
            <span class="status-badge progress">Новых коммитов: {{ detail.new_commits }}</span>
            <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="acknowledge">Принять</button>
          </template>
          <button v-else-if="detail.rewritten" type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="acknowledge">Принять</button>
          <details class="rt-commits">
            <summary>Коммиты</summary>
            <ul><li v-for="c in detail.commits" :key="c.sha"><code>{{ c.sha.slice(0, 8) }}</code> {{ c.subject }} <span class="muted">{{ c.author }}</span></li></ul>
          </details>
        </div>
      </header>
      <div class="workspace">
        <nav class="files" aria-label="Файлы ветки" :style="{ width: filesWidth + 'px' }">
          <div class="files-head">
            Файлы
            <button v-if="detail.round_commits" type="button" class="files-filter" :class="{ on: screen.onlyChanged }" title="Только файлы, изменённые после вашего последнего ревью" @click="screen.onlyChanged = !screen.onlyChanged">новое</button>
          </div>
          <div v-for="file in visibleFiles" :key="file.path" class="file" :class="{ selected: path === file.path }">
            <button type="button" :title="file.path" @click="choose(file.path)">
              <span class="file-name">{{ baseName(file.path) }}</span>
              <span class="file-dir">{{ dirName(file.path) }}</span>
            </button>
            <span v-if="remarksIn(file.path)" class="file-count" title="Замечания: черновики и отправленные">{{ remarksIn(file.path) }}</span>
            <span v-if="threadsIn(file.path)" class="file-count thread" title="Обсуждения в МР">{{ threadsIn(file.path) }}</span>
            <span v-if="questionsIn(file.path)" class="file-count agent" title="Вопросы агенту">{{ questionsIn(file.path) }}</span>
            <span class="file-stat"><span v-if="file.added" class="add">+{{ file.added }}</span> <span v-if="file.deleted" class="del">−{{ file.deleted }}</span></span>
            <span v-if="file.status !== 'M'" class="file-tag" :class="file.status === 'A' ? 'add' : file.status === 'D' ? 'del' : ''">{{ file.status }}</span>
            <span v-if="file.changed_since" class="file-dot" title="Изменён после вашего последнего ревью" />
          </div>
        </nav>
        <div class="rt-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина списка файлов" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'files')" @dblclick="filesWidth = 260" @keydown="resizeKey($event, 'files')" />
        <main class="diff-area">
          <BranchDiff
            v-if="selectedFile" :key="detail.review.id + ':' + path" :scope="scope" :review-id="detail.review.id" :head="detail.review.head" :file="selectedFile"
            :selection="selection" :items="itemsOf(selectedFile.path)" @select="select"
          >
            <template #composer>
              <form class="composer" @submit.prevent="submit" @keydown.esc.stop.prevent="selection = null">
                <div class="rt-row">
                  <strong>Строка {{ selection?.startLine }}{{ selection && selection.endLine !== selection.startLine ? '–' + selection.endLine : '' }}</strong>
                  <div class="rt-seg" role="group" aria-label="Что написать">
                    <button type="button" :class="{ on: kind === 'remark' }" title="Черновик замечания для МР" @click="kind = 'remark'">Замечание</button>
                    <button type="button" :class="{ on: kind === 'question' }" title="Приватный вопрос агенту, автор его не увидит" @click="kind = 'question'">Вопрос агенту</button>
                  </div>
                </div>
                <textarea v-model="draft" class="control composer-text" rows="3" :placeholder="kind === 'remark' ? 'Замечание к этой строке. Ctrl+Enter — в черновики' : 'Вопрос агенту по этой строке. Ctrl+Enter — в очередь'" spellcheck="false" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit" />
                <div class="rt-row">
                  <button class="btn btn-blue btn-sm" :disabled="!draft.trim()">{{ kind === 'remark' ? 'В черновики' : 'В очередь' }}</button>
                  <button type="button" class="btn btn-subtle btn-sm" @click="selection = null">Закрыть</button>
                </div>
              </form>
            </template>
            <template #items="{ line, side }">
              <div class="line-items">
                <RemarkCard v-for="r in remarksAt(selectedFile.path, side, line)" :key="r.id" :remark="r" :screen-key="props.projectId" :scope="scope" :review-id="detail.review.id" />
                <ExternalThreadCard v-for="t in threadsAt(selectedFile.path, side, line)" :key="t.id" :thread="t" :actions="threadActions" />
                <BranchQuestionCard
                  v-for="q in questionsAt(selectedFile.path, side, line)" :key="q.id" :question="q" :messages="messagesOf(q.id)" :screen-key="props.projectId" :scope="scope" :review-id="detail.review.id"
                  @send-now="screen.panel = 'agent'" @to-remark="toRemark(q, $event)"
                />
              </div>
            </template>
          </BranchDiff>
          <div v-else class="empty-state">{{ screen.onlyChanged ? 'После вашего ревью файлы не менялись.' : 'В этом диапазоне нет изменённых файлов.' }}</div>
        </main>
        <div class="rt-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина правой панели" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'side')" @dblclick="sideWidth = 420" @keydown="resizeKey($event, 'side')" />
        <aside class="side" aria-label="Ревью" :style="{ width: sideWidth + 'px' }">
          <div class="side-tabs" role="tablist">
            <button v-for="t in panels" :key="t.id" type="button" role="tab" :aria-selected="screen.panel === t.id" :class="{ on: screen.panel === t.id }" @click="screen.panel = t.id">
              {{ t.label }}<span v-if="t.count" class="side-count">{{ t.count }}</span>
            </button>
          </div>
          <OverviewPanel
            v-if="screen.panel === 'overview'" :screen-key="props.projectId" :scope="scope" :detail="detail" :info="info" :tasks-url="tasksUrl"
            @open-instructions="emit('open-instructions')" @asked="screen.panel = 'agent'"
          />
          <RemarksPanel v-else-if="screen.panel === 'remarks'" :screen-key="props.projectId" :scope="scope" :review-id="detail.review.id" :mr="!!detail.review.mr_iid" @goto="gotoRemark" />
          <DiscussPanel
            v-else-if="screen.panel === 'agent'" :screen-key="props.projectId" :scope="scope" :review-id="detail.review.id" :head="detail.review.head"
            @goto="goto" @to-remark="toRemark"
          />
          <div v-else class="side-threads">
            <div v-if="!info?.threads.length" class="side-empty">В МР пока нет обсуждений.</div>
            <ExternalThreadCard v-for="t in info?.threads ?? []" :key="t.id" :thread="t" :actions="threadActions" show-location @goto="gotoThread(t)" />
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRefs, watch } from 'vue'
import { onServerEvent } from '@core/api/events'
import { useAppStore } from '@core/stores/app'
import { ExternalThreadCard, type ExternalThread, type ExternalThreadActions } from '@features/code'
import type { CodeSide, LineSelection } from '@shared/code-viewer'
import AppButton from '@shared/ui/AppButton.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchQuestion, BranchRef, BranchReview, MrInfo, MrListItem, Remark } from '../types'
import BranchDiff from '../components/BranchDiff.vue'
import BranchQuestionCard from '../components/BranchQuestionCard.vue'
import DiscussPanel from '../components/DiscussPanel.vue'
import MrList from '../components/MrList.vue'
import OverviewPanel from '../components/OverviewPanel.vue'
import RemarkCard from '../components/RemarkCard.vue'
import RemarksPanel from '../components/RemarksPanel.vue'
import { useBranchReviewStore, type ReviewPanel } from '../stores/review'

/** Passed for a group: the review works on one of its projects. */
const props = defineProps<{ projectId: string; members?: { id: string; name: string }[] }>()
const emit = defineEmits<{ 'open-instructions': [] }>()
const app = useAppStore()
const isGroup = computed(() => !!props.members)
const scope = computed(() => isGroup.value ? memberId.value : props.projectId)
/** The screen lives in a store: leaving the tab unmounts it, the open review and its drafts must stay. */
const screen = useBranchReviewStore().of(props.projectId)
const { memberId, list, branch, baseRef, detail, info, path } = toRefs(screen)
const error = ref(''), busy = ref(false), loadingMrs = ref(false), opening = ref<string | null>(null), selection = ref<LineSelection | null>(null), draft = ref('')
const kind = ref<'remark' | 'question'>('remark')
let alive = true
onBeforeUnmount(() => { alive = false })

// Panel widths are view-local and remembered between visits, like on the Код tab.
const clampWidth = (value: number) => Math.min(640, Math.max(220, Math.round(value)))
const stored = (key: string, fallback: number) => clampWidth(Number(localStorage.getItem(key)) || fallback)
const filesWidth = ref(stored('review.filesWidth', 260)), sideWidth = ref(stored('review.sideWidth', 420))
watch(filesWidth, value => localStorage.setItem('review.filesWidth', String(value)))
watch(sideWidth, value => localStorage.setItem('review.sideWidth', String(value)))
function startResize(event: PointerEvent, panel: 'files' | 'side') {
  const startX = event.clientX, target = panel === 'files' ? filesWidth : sideWidth, start = target.value
  const move = (e: PointerEvent) => { target.value = clampWidth(start + (panel === 'files' ? e.clientX - startX : startX - e.clientX)) }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.style.userSelect = '' }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
function resizeKey(event: KeyboardEvent, panel: 'files' | 'side') {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const target = panel === 'files' ? filesWidth : sideWidth
  target.value = clampWidth(target.value + ((event.key === 'ArrowRight') === (panel === 'files') ? 16 : -16))
}

const visibleFiles = computed(() => (detail.value?.files ?? []).filter(f => !screen.onlyChanged || f.changed_since))
const selectedFile = computed(() => visibleFiles.value.find(f => f.path === path.value))
const baseName = (value: string) => value.split('/').pop() ?? value
const dirName = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : ''
const branchOptions = computed(() => list.value.map((b: BranchRef) => ({ value: b.ref, label: b.name })))
const tasksUrl = computed(() => isGroup.value ? '/projects/' + encodeURIComponent(props.projectId) + '/tasks?members=1' : '/projects/' + encodeURIComponent(scope.value) + '/tasks')
const headBehind = computed(() => !!info.value && !!detail.value && info.value.mr.head_sha !== detail.value.review.head)
const approvalsText = computed(() => {
  const a = info.value?.approvals
  if (!a) return '✓ —'
  return '✓ ' + a.count + (a.required ? '/' + a.required : '') + (a.names.length ? ' · ' + a.names.join(', ') : '')
})
const approvalsTitle = computed(() => {
  const a = info.value?.approvals
  return !a ? 'GitLab не отдал аппрувы' : a.left ? 'Нужно ещё аппрувов: ' + a.left : a.required ? 'Аппрувов достаточно' : 'Аппрувы МР'
})
const panels = computed<{ id: ReviewPanel; label: string; count: number }[]>(() => [
  { id: 'overview', label: 'Обзор', count: 0 },
  { id: 'remarks', label: 'Замечания', count: screen.remarks.filter(r => r.status !== 'sent').length },
  { id: 'agent', label: 'Агент', count: screen.questions.length },
  ...(detail.value?.review.mr_iid ? [{ id: 'threads' as const, label: 'Треды', count: info.value?.threads.filter(t => !t.resolved).length ?? 0 }] : []),
])

// What sits under a line of the diff: the developer's and the agent's remarks and colleagues' GitLab threads.
// A published remark of an MR comes back as a GitLab thread: the diff shows the thread, not both.
const inDiff = (r: Remark) => !r.outdated && !(r.status === 'sent' && detail.value?.review.mr_iid)
const remarksAt = (file: string, side: CodeSide, line: number) => screen.remarks.filter(r => r.path === file && r.side === side && r.line === line && inDiff(r))
const threadsAt = (file: string, side: CodeSide, line: number) => (info.value?.threads ?? []).filter(t => t.path === file && t.side === side && t.line === line)
const questionsAt = (file: string, side: CodeSide, line: number) => screen.questions.filter(q => q.path === file && q.side === side && q.line === line)
const messagesOf = (id: string) => screen.messages.filter(m => m.question_id === id)
const itemsOf = (file: string) => [
  ...screen.questions.filter(q => q.path === file).map(q => ({ side: q.side, line: q.line })),
  ...screen.remarks.filter(r => r.path === file && inDiff(r)).map(r => ({ side: r.side, line: r.line })),
  ...(info.value?.threads ?? []).filter(t => t.path === file && t.line).map(t => ({ side: t.side, line: t.line! })),
]
const questionsIn = (file: string) => screen.questions.filter(q => q.path === file).length
const remarksIn = (file: string) => screen.remarks.filter(r => r.path === file && inDiff(r)).length
const threadsIn = (file: string) => (info.value?.threads ?? []).filter(t => t.path === file && t.line).length

async function run<T>(fn: () => Promise<T>, accept?: (value: T) => void) {
  if (busy.value) return undefined
  busy.value = true
  error.value = ''
  try { const result = await fn(); if (alive) accept?.(result); return result }
  catch (cause) { if (alive) error.value = errorText(cause); return undefined }
  finally { if (alive) busy.value = false }
}
const acceptList = (value: { branches: BranchRef[]; current: string | null; default_base: string | null }) => {
  list.value = value.branches
  if (!baseRef.value) baseRef.value = value.default_base ?? ''
  if (!branch.value && value.current) branch.value = value.branches.find(b => !b.remote && b.name === value.current)?.ref ?? ''
}
const acceptDetail = (value: BranchReview) => {
  detail.value = value
  if (!value.files.some(f => f.path === path.value)) path.value = value.files[0]?.path ?? ''
}
const loadBranches = () => scope.value ? run(() => branchReviewApi.branches(scope.value), acceptList) : undefined
async function loadMrs() {
  loadingMrs.value = true
  try { const value = await branchReviewApi.mergeRequests(props.projectId); if (alive) screen.mrs = value }
  catch (cause) { if (alive) error.value = errorText(cause) }
  finally { if (alive) loadingMrs.value = false }
}
const fetchAll = () => run(() => branchReviewApi.fetch(scope.value), acceptList)
const open = () => run(() => branchReviewApi.open(scope.value, branch.value, baseRef.value), acceptDetail)
/** An MR of a group lives in one of its projects: the review switches to it. */
async function openMr(mr: MrListItem) {
  if (opening.value) return
  // Opening fetches origin first, which can take a while: the row shows it is on its way.
  opening.value = mr.project_id + ':' + mr.iid
  try {
    if (isGroup.value) memberId.value = mr.project_id
    await run(() => branchReviewApi.openMergeRequest(mr.project_id, mr.iid), acceptDetail)
  } finally { if (alive) opening.value = null }
}
const refresh = () => run(async () => { const value = await branchReviewApi.refresh(scope.value, detail.value!.review.id); void loadInfo(); return value }, acceptDetail)
const acknowledge = () => run(() => branchReviewApi.acknowledge(scope.value, detail.value!.review.id), acceptDetail)
const approve = (value: boolean) => run(() => branchReviewApi.approve(scope.value, detail.value!.review.id, value), v => { info.value = v; app.toast(value ? 'Аппрув поставлен' : 'Аппрув снят', 'success') })
function choose(value: string) { path.value = value; selection.value = null }
function select(value: LineSelection) { selection.value = value; draft.value = '' }
function clearReview() { detail.value = undefined; info.value = null; screen.remarks = []; screen.thread = null; screen.questions = []; screen.messages = []; screen.onlyChanged = false; selection.value = null; draft.value = '' }
function back() { clearReview(); if (screen.entry === 'mr') void loadMrs(); else void loadBranches() }
function reset() { clearReview(); list.value = []; branch.value = ''; baseRef.value = ''; void loadBranches() }
function revealFile(file: string) { if (screen.onlyChanged && !visibleFiles.value.some(f => f.path === file)) screen.onlyChanged = false; choose(file) }
function goto(question: BranchQuestion) { if (question.path) revealFile(question.path) }
function gotoRemark(remark: Remark) { if (remark.path) revealFile(remark.path) }
function gotoThread(thread: ExternalThread) { if (thread.path) revealFile(thread.path) }

/** A remark goes to the drafts on the right; a question waits in the agent's queue. Nothing leaves until the developer sends it. */
async function submit() {
  const line = selection.value, text = draft.value.trim(), id = detail.value?.review.id
  if (!line || !text || !id) return
  try {
    if (kind.value === 'remark') screen.remarks = (await branchReviewApi.addRemark(scope.value, id, { path: line.path, side: line.side, line: line.startLine, body: text })).remarks
    else {
      const result = await branchReviewApi.addQuestion(scope.value, id, { path: line.path, side: line.side, line: line.startLine, text })
      screen.questions = result.questions; screen.messages = result.messages
    }
    draft.value = ''
    selection.value = null
  } catch (cause) { error.value = errorText(cause) }
}
/** The agent's answer becomes a draft remark at the question's place; the developer edits it there. */
async function toRemark(question: BranchQuestion, text: string) {
  const id = detail.value?.review.id
  if (!id) return
  try {
    const place = question.path ? { path: question.path, side: question.side, line: question.line } : {}
    screen.remarks = (await branchReviewApi.addRemark(scope.value, id, { ...place, body: text })).remarks
    screen.panel = 'remarks'
    app.toast('Черновик замечания создан — отредактируйте его', 'success')
  } catch (cause) { error.value = errorText(cause) }
}
const threadActions: ExternalThreadActions = {
  reply: async (d, body) => { info.value = await branchReviewApi.replyThread(scope.value, detail.value!.review.id, d, body) },
  resolve: async (d, resolved) => { info.value = await branchReviewApi.resolveThread(scope.value, detail.value!.review.id, d, resolved) },
  editNote: async (d, note, body) => { info.value = await branchReviewApi.editNote(scope.value, detail.value!.review.id, d, note, body) },
  deleteNote: async (d, note) => { info.value = await branchReviewApi.deleteNote(scope.value, detail.value!.review.id, d, note) },
}
async function loadInfo() {
  const review = detail.value?.review
  if (!review?.mr_iid) { info.value = null; return }
  try { const value: MrInfo = await branchReviewApi.mr(scope.value, review.id); if (alive && detail.value?.review.id === review.id) info.value = value }
  catch (cause) { if (alive) error.value = errorText(cause) }
}
async function loadThreads(id: string) {
  try {
    const [q, r] = await Promise.all([branchReviewApi.questions(scope.value, id), branchReviewApi.remarks(scope.value, id)])
    if (alive && detail.value?.review.id === id) { screen.questions = q.questions; screen.messages = q.messages; screen.remarks = r.remarks }
  } catch (cause) { if (alive) error.value = errorText(cause) }
}
async function finish() {
  if (!detail.value || !await app.confirm('Завершить ревью? Агент будет закрыт, копия кода для него удалена. Замечания и чаты останутся.', { confirmLabel: 'Завершить' })) return
  try { await branchReviewApi.finish(scope.value, detail.value.review.id); back() } catch (cause) { error.value = errorText(cause) }
}
// The agent session of the open review survives leaving the tab: find it again by the whole-branch thread of the current head.
watch(() => detail.value?.review.id, async id => {
  if (!id || screen.thread) return
  try {
    const threads = await branchReviewApi.threads(scope.value, id)
    const mine = threads.filter(t => !t.path).at(-1)
    if (alive && detail.value?.review.id === id && mine) screen.thread = mine
  } catch (cause) { if (alive) error.value = errorText(cause) }
}, { immediate: true })
watch(() => detail.value?.review.id, id => { if (id) { void loadThreads(id); void loadInfo() } }, { immediate: true })
// The agent works on its own time: overview, remarks and answers follow the server.
let reload: ReturnType<typeof setTimeout> | undefined
const stopEvents = onServerEvent<{ type: string; reviewId?: string }>(event => {
  const id = detail.value?.review.id
  if (!id || event.type !== 'branch_review_updated' || event.reviewId !== id) return
  void loadThreads(id)
  clearTimeout(reload)
  reload = setTimeout(() => { void branchReviewApi.detail(scope.value, id).then(value => { if (alive && detail.value?.review.id === id) detail.value = value }).catch(() => undefined) }, 400)
})
onBeforeUnmount(() => { stopEvents(); clearTimeout(reload) })
if (detail.value) {
  // Back on the tab: refresh what is shown without a fetch; a review whose branch is gone is dropped.
  const id = detail.value.review.id
  void branchReviewApi.detail(scope.value, id).then(value => { if (alive) acceptDetail(value) }).catch(cause => { if (alive) { error.value = errorText(cause); clearReview() } })
}
watch(() => screen.entry, entry => {
  if (detail.value) return
  if (entry === 'branch' && !list.value.length) void loadBranches()
  if (entry === 'mr' && !screen.mrs) void loadMrs()
}, { immediate: true })
</script>
<style scoped>
.review-tab { height: 100%; display: flex; flex-direction: column; min-height: 0; font-size: 13px; }
.rt-alert { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 16px; font-size: 12px; color: var(--danger-hover); background: var(--danger-soft); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.rt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rt-pick, .rt-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
.rt-spacer { flex: 1; }
.rt-entry { flex: 1; display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 1100px; margin: 0 auto; padding: 24px 20px 16px; overflow: auto; min-height: 0; box-sizing: border-box; }
.rt-entry.listing { overflow: hidden; }
.rt-title { display: flex; flex-direction: column; gap: 2px; }
.rt-title h2 { font-size: 16px; }
.rt-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); }
.rt-tabs button, .side-tabs button { padding: 6px 10px; margin-bottom: -1px; font: inherit; font-size: 12.5px; font-weight: 500; color: var(--text-muted); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
.rt-tabs button.on, .side-tabs button.on { color: var(--text); border-bottom-color: var(--blue); }
.rt-form { display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
.rt-seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.rt-seg button { padding: 2px 8px; font: inherit; font-size: 11.5px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.rt-seg button + button { border-left: 1px solid var(--border-strong); }
.rt-seg button.on { color: var(--text); background: var(--blue-soft); }
code { font-size: 11.5px; }
.rt-head { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.rt-head h3 { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-mr { flex: 1; }
.rt-mr a { color: var(--blue-hover); text-decoration: none; }
.rt-approvals { font-size: 12px; color: var(--text-muted); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-approvals.mine { color: var(--accent-hover); }
.rt-meta { font-size: 12px; color: var(--text-muted); }
.rt-commits { width: 100%; }
.rt-commits summary { cursor: pointer; font-size: 12px; }
.rt-commits ul { max-height: 160px; overflow: auto; margin: 4px 0 0; padding-left: 16px; font-size: 12px; }
.workspace { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.rt-resizer { position: relative; z-index: 2; flex-shrink: 0; width: 0; cursor: col-resize; outline: none; }
.rt-resizer::before { content: ''; position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; opacity: 0.6; transition: background 0.12s; }
.rt-resizer:hover::before, .rt-resizer:focus-visible::before { background: var(--blue); }
.files { flex-shrink: 0; overflow: auto; border-right: 1px solid var(--border); }
.files-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.files-filter { margin-left: auto; padding: 0 6px; font: inherit; font-size: 10.5px; text-transform: none; letter-spacing: 0; color: var(--warning-text); background: none; border: 1px solid var(--warning-soft); border-radius: var(--radius-pill); cursor: pointer; }
.files-filter.on { background: var(--warning-soft); }
.file { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 10px; }
.file:hover { background: var(--bg-hover); }
.file.selected { background: var(--blue-soft); }
.file button { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 2px 0; font: inherit; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.file-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-dir { font-size: 10.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-count { flex-shrink: 0; min-width: 16px; padding: 0 5px; font-size: 10px; font-weight: 600; text-align: center; border-radius: var(--radius-pill); background: rgba(56, 139, 253, 0.25); color: var(--blue-hover); }
.file-count.thread { background: rgba(210, 153, 34, 0.28); color: var(--warning-text); }
.file-count.agent { background: rgba(35, 134, 54, 0.28); color: var(--accent-hover); }
.file-stat { flex-shrink: 0; font-size: 10.5px; }
.file-stat .add, .file-tag.add { color: #3fb950; }
.file-stat .del, .file-tag.del { color: var(--danger-hover); }
.file-tag { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--blue-hover); }
.file-dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--warning-text); }
.diff-area { flex: 1; min-width: 0; overflow: auto; display: flex; flex-direction: column; }
.diff-area > div { flex: 1; }
.composer { display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: min(100%, 640px); margin: 4px 0; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); font-size: 12px; }
.composer-text { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.line-items { display: flex; flex-direction: column; gap: 4px; width: min(100%, 640px); }
.line-items:empty { display: none; }
.side { flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); font-size: 12px; }
.side-tabs { display: flex; gap: 2px; padding: 0 6px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.side-count { margin-left: 4px; padding: 0 5px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); }
.side-threads { flex: 1; min-height: 0; overflow: auto; padding: 4px 10px 10px; }
.side-empty { padding: 8px 2px; color: var(--text-muted); }
</style>
