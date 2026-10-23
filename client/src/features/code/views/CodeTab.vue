<template>
  <div class="ct">
    <header class="ct-head">
      <button v-if="task" type="button" class="ct-crumb" @click="emit('back')">← Задача-{{ task.key }}</button>
      <template v-if="store.repository">
        <span v-if="store.head" class="ct-head-commit" :title="store.repository.message ?? ''">
          HEAD <code>{{ store.head.slice(0, 7) }}</code><template v-if="store.repository.message"> «{{ store.repository.message }}»</template>
        </span>
        <span class="ct-sep">·</span>
        <span class="ct-total">{{ store.changes.length }} {{ plural(store.changes.length) }} <span class="plus">+{{ totals.added }}</span> <span class="minus">−{{ totals.deleted }}</span></span>
      </template>
      <span v-else-if="store.loading || !loaded" class="ct-muted">Загрузка…</span>
      <span v-else class="ct-muted" title="Просмотр файлов и поиск работают, изменения и ревью строк недоступны">Папка не под git — урезанный режим</span>
      <template v-if="store.review">
        <span class="ct-sep">·</span>
        <span class="ct-review" :class="{ readonly: reviewReadOnly }">Ревью #{{ store.review.number }}<template v-if="rounds"> · раунд {{ rounds }}</template><template v-if="drafts"> · {{ drafts }} {{ draftWord }}</template></span>
      </template>
      <span class="ct-spacer" />
      <span v-if="store.watchError" class="ct-warn" :title="store.watchError">авто-обновление недоступно</span>
      <button v-if="store.repository" type="button" class="btn btn-sm" :class="finishAttention ? 'btn-blue' : 'btn-ghost'" title="Коммиты, push и МР — агент сделает их по настройкам проекта" @click="showRight('finish')">
        {{ finish.run && !finishDone ? 'Завершение · ' + (finishStages[finish.run.stage] || finish.run.stage) : 'Завершить работу' }}
      </button>
      <button type="button" class="ct-refresh" :class="{ spinning: store.loading }" :disabled="store.loading" title="Обновить: статус, дерево и открытый файл" :aria-busy="store.loading" aria-label="Обновить" @click="store.refresh()">⟳</button>
      <HistoryMenu :history="store.history" :opened-id="store.openedReviewId" @open="store.loadHistory()" @select="store.openReview($event)" @remove="removeHistoryItem" />
    </header>
    <div v-if="conflicts.operation" class="ct-op" role="status">
      <span class="ct-op-text">{{ operationTitle(conflicts.operation) }} · {{ conflicts.conflicted.length ? 'конфликтов: ' + conflicts.conflicted.length : 'конфликтов нет' }}<template v-if="conflicts.working"> · агент работает</template></span>
      <button v-if="conflicts.conflicted.length && !conflicts.state?.session" type="button" class="btn btn-blue btn-xs" :disabled="conflicts.busy" @click="resolveConflicts">Разрешить с агентом</button>
      <button v-else type="button" class="btn btn-ghost btn-xs" @click="showRight('conflicts')">Конфликты</button>
    </div>
    <ReviewBanners @open-items="openFirstUnresolved" />
    <div v-if="store.error" class="ct-error">{{ store.error }} <button type="button" class="ct-link" @click="store.refresh()">Повторить</button></div>

    <div class="ct-body" :style="{ gridTemplateColumns: `${leftCollapsed ? RAIL : leftWidth}px 0 minmax(0, 1fr) 0 ${rightCollapsed ? RAIL : rightWidth}px` }">
      <PaneRail
        v-if="leftCollapsed" side="left" shortcut="Ctrl+B" @expand="leftCollapsed = false" @pick="selectLeft($event as LeftTab)"
        :items="leftTabs.map(t => ({ id: t.id, label: t.label, icon: t.id, count: t.count }))"
      />
      <aside v-show="!leftCollapsed" class="ct-left">
        <div class="ct-tabs" role="tablist">
          <button v-for="t in leftTabs" :key="t.id" type="button" role="tab" class="ct-tab" :class="{ active: leftTab === t.id }" :aria-selected="leftTab === t.id" @click="selectLeft(t.id)">
            {{ t.label }}<span v-if="t.count" class="ct-count">{{ t.count }}</span>
          </button>
          <button type="button" class="ct-collapse" title="Свернуть панель (Ctrl+B)" aria-label="Свернуть левую панель" @click="leftCollapsed = true">«</button>
        </div>
        <div v-show="leftTab === 'changes'" class="ct-pane">
          <BaseSwitcher />
          <ChangesList
            :changes="store.shownChanges" :stats="store.shownStats" :selected="store.selectedPath" :empty-text="emptyText"
            :stageable="stageable" :stage-disabled="git.blocked" @toggle-stage="toggleStage" @stage-many="stageMany" @open="openChange"
          >
            <template #empty>
              <span>{{ emptyText }}</span>
              <button v-if="stageable && git.baseRef" type="button" class="btn btn-ghost btn-xs" :title="'Все изменения ветки относительно ' + git.baseRef" @click="store.setBase('remote', git.baseRef)">Diff ветки</button>
            </template>
            <template #badges="{ change }">
              <span v-if="store.effectiveBase === 'agent' && !fileCounts[change.path]" class="ct-badge" title="Агент тронул этот файл, хотя замечаний к нему не было">без замечаний</span>
              <span v-if="fileCounts[change.path]" class="ct-badge" :title="`Замечаний: ${fileCounts[change.path]}`">💬{{ fileCounts[change.path] }}</span>
            </template>
          </ChangesList>
        </div>
        <template v-if="leftTab === 'changes' && store.repository">
          <BranchBar :key="'branch' + projectId" :task="task" />
          <CommitBox v-if="!store.openedReviewId" :key="projectId" :task-id="task?.id" />
        </template>
        <div v-show="leftTab === 'files'" class="ct-pane">
          <FileTree
            ref="tree" :trees="store.trees" :selected="store.selectedPath" :show-ignored="store.includeIgnored" :marks="fileCounts"
            @load="store.loadTree($event)" @select="open($event, 'file')" @update:show-ignored="store.setIncludeIgnored($event)"
          />
        </div>
        <div v-show="leftTab === 'search'" class="ct-pane">
          <SearchPanel ref="search" @open="openFound" />
        </div>
      </aside>
      <div class="ct-resizer" :class="{ off: leftCollapsed }" role="separator" aria-orientation="vertical" aria-label="Ширина левой панели" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'left')" @dblclick="leftWidth = 300" @keydown="resizeKey($event, 'left')" />

      <main class="ct-center">
        <FileViewer
          ref="viewer" v-model:mode="mode" :project-id="projectId"
          :markers="markers.new" :old-markers="markers.old" :widget-lines="widgets.new" :old-widget-lines="widgets.old"
          @select="onSelect" @marker-click="onMarker"
        >
          <template #header="{ path }">
            <button type="button" class="ct-link" title="Показать файл в дереве" @click="showInTree(path)">Показать в дереве</button>
            <button v-if="!reviewReadOnly" type="button" class="ct-link" title="Замечание ко всему файлу" @click="composing = { scope: 'file' }">💬<template v-if="fileNotes.length"> {{ fileNotes.length }}</template></button>
            <span v-else-if="fileNotes.length" class="ct-muted">💬 {{ fileNotes.length }}</span>
          </template>
          <template #notes="{ path }">
            <div v-if="fileNotes.length || composing?.scope === 'file'" class="ct-notes">
              <ItemView v-for="item in fileNotes" :key="item.id" :item="item" :read-only="reviewReadOnly" @open-ref="openRef" @show-change="showChange" />
              <ItemComposer v-if="composing?.scope === 'file'" :where="path" :busy="draftBusy" :error="draftError" @save="saveDraft" @cancel="cancelCompose" />
            </div>
          </template>
          <template #widget="{ line, side }">
            <div class="ct-widget">
              <ExternalThreadCard v-for="t in externalAt(line, side)" :key="t.id" :thread="t" :can-discuss="canDiscuss" @discuss="discussExternal" />
              <ItemView v-for="item in itemsAt(line, side)" :key="item.id" :item="item" :read-only="reviewReadOnly" @open-ref="openRef" @show-change="showChange" />
              <ItemComposer
                v-if="composing?.scope === 'line' && composing.side === side && composing.end === line" :where="composeWhere"
                :busy="draftBusy" :error="draftError" @save="saveDraft" @cancel="cancelCompose"
              />
            </div>
          </template>
        </FileViewer>
      </main>
      <div class="ct-resizer" :class="{ off: rightCollapsed }" role="separator" aria-orientation="vertical" aria-label="Ширина правой панели" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'right')" @dblclick="rightWidth = 380" @keydown="resizeKey($event, 'right')" />

      <PaneRail v-if="rightCollapsed" side="right" shortcut="Ctrl+Alt+B" :items="rightRail" @expand="rightCollapsed = false" @pick="showRight($event as RightTab)" />
      <aside v-show="!rightCollapsed" class="ct-right">
        <div class="ct-tabs" role="tablist">
          <button v-for="t in rightTabs" :key="t.id" type="button" role="tab" class="ct-tab" :class="{ active: rightTab === t.id }" :aria-selected="rightTab === t.id" @click="rightTab = t.id">
            {{ t.label }}<span v-if="t.count" class="ct-count" :class="{ warning: t.warning }" :title="t.hint">{{ t.count }}</span>
          </button>
          <button type="button" class="ct-collapse" title="Свернуть панель (Ctrl+Alt+B)" aria-label="Свернуть правую панель" @click="rightCollapsed = true">»</button>
        </div>
        <div v-if="rightTab === 'conflicts'" class="ct-scroll">
          <ConflictPanel @open="path => open(path, 'diff')" />
        </div>
        <template v-if="rightTab === 'remarks'">
          <ExternalThreadsPanel :can-discuss="canDiscuss" @goto="gotoExternal" @discuss="discussExternal" />
          <div class="ct-pane">
            <ReviewPanel :project-id="projectId" :origin="origin" :default-agent-id="defaultAgentId" @goto="goto" @open-ref="openRef" @show-change="showChange" />
          </div>
        </template>
        <!-- Kept mounted: the finish run reports its progress (and the tab's badge) while another tab is open. -->
        <div v-if="store.repository" v-show="rightTab === 'finish'" class="ct-scroll">
          <FinishPanel :key="projectId + (task?.id || '')" :project-id="projectId" :task="task" :blocked="git.writeBlocked" :branch="store.branch" @attention="showRight('finish')" />
        </div>
        <div v-if="store.repository && rightTab === 'mr'" class="ct-scroll">
          <TaskMrPanel :key="projectId + (task?.id || '')" :project-id="projectId" :task-id="task?.id" stacked />
        </div>
      </aside>
    </div>

    <QuickOpen v-if="quickOpen" :files="store.files" @pick="path => { quickOpen = false; open(path, 'file') }" @close="quickOpen = false" />
  </div>
</template>

<script lang="ts">
// Module-level so the open file survives switching project tabs (the screen unmounts and stops watching).
const lastOpened = new Map<string, string>()
</script>

<script setup lang="ts">
import { FinishPanel } from '@features/finish'
import { TaskMrPanel } from '@features/task-mr'
import { useFinishStore, finishStages as stages } from '@features/finish'
import { useRoute } from 'vue-router'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileTree, type CodeSide, type LineMarker, type LineSelection } from '@shared/code-viewer'
import { useAppStore } from '@core/stores/app'
import { codeReviewsApi } from '../api'
import { useCodeStore } from '../stores/code'
import { useReviewAgentStore } from '../stores/review-agent'
import { threadState } from '../utils/thread'
import type { CodeReviewItem, GitChange, ReviewHistory } from '../types'
import { useGitStore } from '../stores/git'
import BranchBar from '../components/BranchBar.vue'
import CommitBox from '../components/CommitBox.vue'
import BaseSwitcher from '../components/BaseSwitcher.vue'
import ChangesList from '../components/ChangesList.vue'
import FileViewer from '../components/FileViewer.vue'
import HistoryMenu from '../components/HistoryMenu.vue'
import ItemComposer from '../components/ItemComposer.vue'
import ItemView from '../components/ItemView.vue'
import ExternalThreadCard from '../components/ExternalThreadCard.vue'
import ExternalThreadsPanel from '../components/ExternalThreadsPanel.vue'
import { useExternalThreadsStore } from '../stores/external'
import type { ExternalThread } from '../types'
import PaneRail from '../components/PaneRail.vue'
import QuickOpen from '../components/QuickOpen.vue'
import ReviewBanners from '../components/ReviewBanners.vue'
import ReviewPanel from '../components/ReviewPanel.vue'
import SearchPanel from '../components/SearchPanel.vue'
import ConflictPanel from '../components/ConflictPanel.vue'
import { useConflictsStore } from '../stores/conflicts'
import { operationTitle } from '../utils/operation'

const props = defineProps<{
  projectId: string
  /** The task the screen was opened from: shows the «← Задача-N» crumb and files the review under it. */
  task?: { id: string; key: string } | null
  /** Agent preselected when sending a round: the task's agent, else the project's. */
  defaultAgentId?: string | null
}>()
const emit = defineEmits<{ back: [] }>()

const git = useGitStore()
const external = useExternalThreadsStore()
watch(() => props.projectId, id => external.reset(id), { immediate: true })
const pathsOf = (list: GitChange[]) => list.flatMap(c => [c.path, ...(c.originalPath ? [c.originalPath] : [])])
async function stageMany(list: GitChange[], stage: boolean) { try { await git.run(stage ? 'stage' : 'unstage', { paths: pathsOf(list) }); await store.refresh() } catch { /* git error displayed in the branch bar */ } }
const toggleStage = (change: GitChange) => stageMany([change], change.status === 'U' || ['.', ' ', '?'].includes(change.indexStatus))
/** Ticks «к коммиту» only make sense for the folder against HEAD. */
const stageable = computed(() => !!store.repository && store.effectiveBase === 'head' && !store.openedReviewId)
watch(() => props.projectId, id => { void git.start(id) }, { immediate: true })
const store = useCodeStore()
const app = useAppStore()
const viewer = ref<InstanceType<typeof FileViewer>>()
const tree = ref<InstanceType<typeof FileTree>>()
const search = ref<InstanceType<typeof SearchPanel>>()
type LeftTab = 'changes' | 'files' | 'search'
const leftTab = ref<LeftTab>('changes')
const agent = useReviewAgentStore()
const mode = ref<'diff' | 'file'>('diff')
const quickOpen = ref(false)
const loaded = ref(false)

// --- panel widths (view-local, remembered between visits) -------------------
const clampWidth = (value: number) => Math.min(640, Math.max(220, Math.round(value)))
const stored = (key: string, fallback: number) => clampWidth(Number(localStorage.getItem(key)) || fallback)
const leftWidth = ref(stored('code.leftWidth', 300))
const rightWidth = ref(stored('code.rightWidth', 380))
watch(leftWidth, value => localStorage.setItem('code.leftWidth', String(value)))
watch(rightWidth, value => localStorage.setItem('code.rightWidth', String(value)))
// A collapsed side panel becomes a rail of icons; the code gets the width.
const RAIL = 40
const leftCollapsed = ref(localStorage.getItem('code.leftCollapsed') === '1')
const rightCollapsed = ref(localStorage.getItem('code.rightCollapsed') === '1')
watch(leftCollapsed, value => localStorage.setItem('code.leftCollapsed', value ? '1' : '0'))
watch(rightCollapsed, value => localStorage.setItem('code.rightCollapsed', value ? '1' : '0'))
function startResize(event: PointerEvent, side: 'left' | 'right') {
  const startX = event.clientX
  const start = side === 'left' ? leftWidth.value : rightWidth.value
  const move = (e: PointerEvent) => {
    const next = clampWidth(start + (side === 'left' ? e.clientX - startX : startX - e.clientX))
    if (side === 'left') leftWidth.value = next
    else rightWidth.value = next
  }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.style.userSelect = '' }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
function resizeKey(event: KeyboardEvent, side: 'left' | 'right') {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = (event.key === 'ArrowRight') === (side === 'left') ? 16 : -16
  if (side === 'left') leftWidth.value = clampWidth(leftWidth.value + delta)
  else rightWidth.value = clampWidth(rightWidth.value + delta)
}

const totals = computed(() => {
  let added = 0
  let deleted = 0
  for (const change of store.changes) { added += store.stats[change.path]?.added ?? 0; deleted += store.stats[change.path]?.deleted ?? 0 }
  return { added, deleted }
})
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'файл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'файла' : 'файлов')
const leftTabs = computed(() => [
  { id: 'changes' as const, label: 'Изменения', count: store.shownChanges.length },
  { id: 'files' as const, label: 'Файлы', count: 0 },
  { id: 'search' as const, label: 'Поиск', count: 0 },
])
const emptyText = computed(() => {
  if (!store.repository) return 'Папка не под git — изменений нет'
  if (store.effectiveBase === 'review') return 'В ревью не вошло ни одного файла'
  if (store.effectiveBase === 'remote') return `Нет отличий от ${store.remoteRef}`
  if (store.effectiveBase === 'agent') return 'После последнего раунда агент ничего не менял'
  return 'Нет изменений для коммита'
})
async function removeHistoryItem(item: ReviewHistory) {
  if (!(await app.confirm(`Удалить ревью #${item.number} вместе с его чатами с агентом? Это нельзя отменить.`, { confirmLabel: 'Удалить', danger: true }))) return
  try { await store.removeReview(item.id) } catch (cause) { app.toast(cause instanceof Error ? cause.message : 'Не удалось удалить', 'error') }
}
function openFirstUnresolved() {
  const item = store.items.find(i => !i.closed && ['done', 'answered', 'needs_decision'].includes(i.status)) ?? store.items.find(i => !i.closed)
  if (item?.file) goto(item)
}

// --- review comments -------------------------------------------------------
type Compose = { scope: 'file' } | { scope: 'line'; side: CodeSide; start: number; end: number }
const composing = ref<Compose | null>(null)
const draftBusy = ref(false)
const draftError = ref('')
const origin = computed(() => (props.task ? { type: 'task' as const, id: props.task.id } : { type: 'project' as const, id: props.projectId }))
const reviewReadOnly = computed(() => store.readOnly || (!!store.openedReviewId && store.openedReview?.review.status !== 'open'))
const rounds = computed(() => store.openedReview?.rounds.length ?? store.current?.summary?.rounds ?? 0)
const drafts = computed(() => store.items.filter(i => i.status === 'draft').length)
const draftWord = computed(() => (drafts.value % 10 === 1 && drafts.value % 100 !== 11 ? 'черновик' : drafts.value % 10 >= 2 && drafts.value % 10 <= 4 && (drafts.value % 100 < 12 || drafts.value % 100 > 14) ? 'черновика' : 'черновиков'))

const fileCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const item of store.items) if (item.file) counts[item.file] = (counts[item.file] ?? 0) + 1
  return counts
})
const currentItems = computed(() => store.items.filter(item => item.file === store.selectedPath && !item.outdated && (item.side !== 'old' || (item.comparison_base ? item.comparison_base === store.diffEnds?.base : store.effectiveBase !== 'remote'))))
const fileNotes = computed(() => currentItems.value.filter(item => item.scope === 'file'))
const endLine = (item: CodeReviewItem) => item.line_end ?? item.line_start ?? 0
// Colleagues' threads of the branch's MR, shown on their lines beside the review items.
const externalHere = computed(() => (external.data?.threads ?? []).filter(t => t.path === store.selectedPath))
const externalAt = (line: number, side: CodeSide) => externalHere.value.filter(t => t.line === line && t.side === side)
const markers = computed(() => {
  const result: Record<CodeSide, LineMarker[]> = { new: [], old: [] }
  for (const item of currentItems.value) {
    if (item.scope !== 'line' || item.line_start == null) continue
    const list = result[item.side]
    const found = list.find(m => m.line === item.line_start)
    if (found) found.count = (found.count ?? 1) + 1
    else list.push({ line: item.line_start, count: 1, title: 'Замечания к строке' })
  }
  for (const t of externalHere.value) {
    if (t.line == null) continue
    const found = result[t.side].find(m => m.line === t.line)
    if (found) found.count = (found.count ?? 1) + 1
    else result[t.side].push({ line: t.line, count: 1, title: 'Комментарий из МР' })
  }
  return result
})
const widgets = computed(() => {
  const result: Record<CodeSide, Set<number>> = { new: new Set(), old: new Set() }
  for (const item of currentItems.value) if (item.scope === 'line') result[item.side].add(endLine(item))
  for (const t of externalHere.value) if (t.line != null) result[t.side].add(t.line)
  const c = composing.value
  if (c?.scope === 'line') result[c.side].add(c.end)
  return { new: [...result.new], old: [...result.old] }
})
const itemsAt = (line: number, side: CodeSide) => currentItems.value.filter(item => item.scope === 'line' && item.side === side && endLine(item) === line)
const composeWhere = computed(() => {
  const c = composing.value
  if (c?.scope !== 'line') return ''
  return `${store.selectedPath}:${c.start}${c.end !== c.start ? '–' + c.end : ''}${c.side === 'old' ? ' (удалённые строки)' : ''}`
})

function cancelCompose() { composing.value = null; draftError.value = ''; viewer.value?.clearSelection() }
function onSelect(selection: LineSelection) {
  if (reviewReadOnly.value) { viewer.value?.clearSelection(); return }
  if (!store.repository) { viewer.value?.clearSelection(); app.toast('Замечания к строкам доступны только в git-репозитории', 'error'); return }
  composing.value = { scope: 'line', side: selection.side, start: selection.startLine, end: selection.endLine }
}
function onMarker(line: number, side: CodeSide) {
  if (!reviewReadOnly.value && store.repository) composing.value = { scope: 'line', side, start: line, end: line }
}
async function saveDraft(value: { kind: 'fix' | 'question'; text: string; refs: string[] }) {
  const c = composing.value
  const file = store.selectedPath
  if (!c || !file) return
  draftBusy.value = true; draftError.value = ''
  try {
    await store.addDraft(c.scope === 'file'
      ? { scope: 'file', file, ...value }
      : { scope: 'line', file, side: c.side, line_start: c.start, line_end: c.end, ...value, ...(store.effectiveBase === 'remote' ? { comparison_ref: store.remoteRef } : {}) }, origin.value.type, origin.value.id)
    cancelCompose()
  } catch (cause) { draftError.value = cause instanceof Error ? cause.message : 'Не удалось сохранить'; app.toast(draftError.value, 'error') }
  finally { draftBusy.value = false }
}

// The server re-anchors the lines of a file by their snippet when it is opened; a moved anchor reloads the review.
let anchoring = 0
async function reanchor() {
  const review = store.review
  const path = store.selectedPath
  if (!review || !path || !store.file) return
  const turn = ++anchoring
  const change = store.changes.find(c => c.path === path)
  const sides: CodeSide[] = change && ['M', 'D', 'R'].includes(change.status) ? ['new', 'old'] : ['new']
  try {
    const key = (i: CodeReviewItem) => `${i.line_start}:${i.line_end}:${i.outdated}`
    const before = new Map(store.items.map(i => [i.id, key(i)]))
    const moved = (await Promise.all(sides.map(side => codeReviewsApi.fileItems(props.projectId, review.id, path, side)))).flat()
    if (turn === anchoring && moved.some(i => before.get(i.id) !== key(i))) await store.refresh()
  } catch { /* anchors stay as stored */ }
}
watch([() => store.selectedPath, () => store.file, () => store.review?.id], () => { void reanchor() })
watch(() => store.selectedPath, () => { composing.value = null })

// --- navigation ------------------------------------------------------------
async function selectLeft(tab: LeftTab) {
  leftCollapsed.value = false
  leftTab.value = tab
  if (tab === 'search') { await nextTick(); search.value?.focus() }
}

/** Opens a file; `line` scrolls to it once the content is on screen. */
async function open(path: string, as: 'diff' | 'file', line?: number, side: CodeSide = 'new') {
  mode.value = as
  if (store.selectedPath !== path) await store.selectFile(path)
  lastOpened.set(props.projectId, path)
  if (line) {
    // The viewer mounts one tick after the file arrives.
    await nextTick(); await nextTick()
    await viewer.value?.scrollToLine(line, side)
  }
}
const openChange = (change: GitChange) => open(change.path, 'diff')

async function showInTree(path: string) {
  leftCollapsed.value = false
  leftTab.value = 'files'
  await nextTick()
  tree.value?.reveal(path)
}
function goto(item: CodeReviewItem) {
  if (!item.file) return
  const changed = store.changes.some(c => c.path === item.file)
  const as = item.side === 'old' || (changed && store.selectedPath !== item.file) ? 'diff' : store.selectedPath === item.file ? mode.value : 'file'
  void open(item.file, as, item.scope === 'line' ? item.line_start ?? undefined : undefined, item.side)
}
function gotoExternal(t: ExternalThread) {
  if (!t.path) return
  const changed = store.changes.some(c => c.path === t.path)
  void open(t.path, t.side === 'old' || changed ? 'diff' : 'file', t.line ?? undefined, t.side)
}
/** «Разобрать с агентом»: the colleague's comment becomes an ordinary review item, discussed in its thread. */
const canDiscuss = computed(() => !!store.repository && !reviewReadOnly.value)
async function discussExternal(t: ExternalThread) {
  const quote = t.notes.map(n => '> **' + n.author + ':** ' + n.body.replace(/\r?\n/g, '\n> ')).join('\n>\n')
  const text = 'Комментарий из МР:\n\n' + quote + '\n\nРазберись, прав ли коллега.'
  try {
    await store.addDraft(t.path && t.line != null && store.changes.some(c => c.path === t.path)
      ? { scope: 'line', file: t.path, side: t.side, line_start: t.line, line_end: t.line, kind: 'question', text, refs: [] }
      : { scope: 'general', kind: 'question', text, refs: [] }, origin.value.type, origin.value.id)
    app.toast('Комментарий добавлен в замечания', 'success')
  } catch (cause) { app.toast(cause instanceof Error ? cause.message : 'Не удалось добавить пункт', 'error') }
}
// --- right panel: the review and its agent ---------------------------------------
const attention = computed(() => store.items.filter(item => threadState(item, store.messages) === 'waiting').length)
// --- right panel tabs: the review, «Завершение работ» and the branch's MR ----------
type RightTab = 'remarks' | 'finish' | 'mr' | 'conflicts'
const route = useRoute()
const finish = useFinishStore()
const finishStages = stages
const rightTab = ref<RightTab>(route.query.finish === '1' ? 'finish' : 'remarks')
const finishDone = computed(() => !!finish.run && ['complete', 'cancelled'].includes(finish.run.status))
const finishAttention = computed(() => !!finish.run && ['waiting', 'error'].includes(finish.run.status))
function showRight(tab: RightTab) { rightCollapsed.value = false; rightTab.value = tab }
watch(() => route.query.finish, value => { if (value === '1') showRight('finish') })
// --- the developer's merge/rebase: its conflicts and the agent resolving them ----------
const conflicts = useConflictsStore()
watch(() => props.projectId, id => { void conflicts.start(id) }, { immediate: true })
const conflictAttention = computed(() => conflicts.state?.files.filter(f => f.conflicted && f.note && f.note.outcome !== 'resolved' && !f.note.answer).length ?? 0)
watch(() => conflicts.operation, operation => { if (!operation && rightTab.value === 'conflicts') rightTab.value = 'remarks' })
async function resolveConflicts() {
  showRight('conflicts')
  await conflicts.resolve()
}
const rightTabs = computed(() => [
  ...(conflicts.operation ? [{ id: 'conflicts' as const, label: 'Конфликты', count: conflictAttention.value || conflicts.conflicted.length, warning: !!conflictAttention.value, hint: conflictAttention.value ? `Агент ждёт ответа: ${conflictAttention.value}` : 'Конфликтных файлов' }] : []),
  { id: 'remarks' as const, label: 'Замечания', count: attention.value || store.items.length, warning: !!attention.value, hint: attention.value ? `Ждут вашего ответа: ${attention.value}` : '' },
  { id: 'finish' as const, label: 'Завершение', count: finishAttention.value ? 1 : 0, warning: true, hint: 'Ждёт вашего решения' },
  { id: 'mr' as const, label: 'МР', count: 0, warning: false, hint: '' },
])
const rightRail = computed(() => [
  ...(conflicts.operation ? [{ id: 'conflicts', label: 'Конфликты', icon: 'conflicts' as const, count: conflictAttention.value || conflicts.conflicted.length, tone: conflictAttention.value ? 'warning' as const : undefined, dot: conflicts.state?.session?.status }] : []),
  { id: 'remarks', label: 'Замечания', icon: 'remarks' as const, count: attention.value || store.items.length, tone: attention.value ? 'warning' as const : undefined, dot: agent.session?.status },
  { id: 'finish', label: 'Завершение работ', icon: 'finish' as const, count: finishAttention.value ? 1 : 0, tone: 'warning' as const },
  { id: 'mr', label: 'МР', icon: 'mr' as const },
])
/** «Посмотреть правку»: the agent's changes of that round, opened at the file it named. */
async function showChange(roundId: string, file?: string) {
  await store.setBase('agent', roundId)
  const target = file && store.shownChanges.some(c => c.path === file) ? file : store.shownChanges[0]?.path
  leftCollapsed.value = false
  leftTab.value = 'changes'
  if (target) await open(target, 'diff')
}
/** A search hit: a line opens the file there; a file found by name opens like in the changes list. */
const openFound = (path: string, line?: number) => open(path, line || !store.changes.some(c => c.path === path) ? 'file' : 'diff', line)

function openRef(ref: string) {
  if (store.files.includes(ref)) void open(ref, 'file')
  else void showInTree(ref)
}

function onKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.code || `Key${event.key.toUpperCase()}`
  // Ctrl+B / Ctrl+Alt+B toggle the side panels, as in VS Code; `code` works in any keyboard layout.
  if (key === 'KeyB' && !event.shiftKey) {
    event.preventDefault()
    if (event.altKey) rightCollapsed.value = !rightCollapsed.value
    else leftCollapsed.value = !leftCollapsed.value
    return
  }
  if (event.altKey) return
  if (key === 'KeyP' && !event.shiftKey) { event.preventDefault(); quickOpen.value = true }
  else if (key === 'KeyF' && event.shiftKey) {
    event.preventDefault()
    const selected = window.getSelection()?.toString().split('\n')[0]
    void selectLeft('search').then(() => search.value?.focus(selected))
  } else if (key === 'KeyF') {
    // The screen owns Ctrl+F: the browser find would not see the virtualised lines anyway.
    event.preventDefault()
    void viewer.value?.openFind()
  }
}

async function begin(projectId: string) {
  loaded.value = false
  await store.start(projectId)
  loaded.value = true
  if (store.projectId !== projectId) return
  const remembered = lastOpened.get(projectId)
  if (remembered) { await open(remembered, store.changes.some(c => c.path === remembered) ? 'diff' : 'file'); return }
  const first = [...store.changes].sort((a, b) => a.path.localeCompare(b.path))[0]
  if (first) await open(first.path, 'diff')
}

onMounted(() => { window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); store.stop(); git.stop(); conflicts.stop() })
watch(() => props.projectId, id => { void begin(id) }, { immediate: true })
</script>

<style scoped>
.ct { --diff-add: #3fb950; --diff-del: var(--danger-hover); --diff-mod: var(--blue-hover); display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: var(--bg); }
.ct-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 38px; padding: 4px 14px; border-bottom: 1px solid var(--border); font-size: 13px; }
.ct-crumb { padding: 2px 8px; font: inherit; font-size: 12px; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.ct-crumb:hover { text-decoration: underline; }
.ct-head-commit { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
.ct-head-commit code { font-size: 12px; }
.ct-sep { color: var(--text-faint); }
.ct-total { white-space: nowrap; color: var(--text-muted); }
.ct-review { white-space: nowrap; color: var(--blue-hover); font-weight: 500; }
.ct-review.readonly { color: var(--warning-text); }
.ct-muted { color: var(--text-muted); font-size: 12px; }
.ct-warn { font-size: 12px; color: var(--warning-text); }
.ct-spacer { flex: 1; }
.ct-refresh { width: 26px; height: 24px; font-size: 15px; line-height: 1; color: var(--text-muted); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.ct-refresh:hover:not(:disabled) { color: var(--text); background: var(--bg3); }
.ct-refresh:disabled { cursor: progress; }
.ct-crumb:focus-visible, .ct-refresh:focus-visible, .ct-tab:focus-visible, .ct-link:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; border-radius: var(--radius-sm); }
.ct-refresh.spinning { animation: ct-spin 0.9s linear infinite; }
@keyframes ct-spin { to { transform: rotate(360deg); } }
.ct-op { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex-shrink: 0; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid var(--border); background: var(--warning-bg, var(--bg2)); box-shadow: inset 3px 0 0 var(--warning); }
.ct-op-text { flex: 1 1 320px; min-width: 0; color: var(--text); }
.ct-error { padding: 6px 14px; font-size: 12px; color: var(--danger-hover); background: var(--danger-soft); border-bottom: 1px solid var(--border); }
.ct-link { padding: 0 6px; font: inherit; font-size: 12px; color: var(--blue-hover); background: none; border: none; cursor: pointer; white-space: nowrap; }
.ct-link:hover { text-decoration: underline; }
.ct-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px 0 minmax(0, 1fr) 0 380px; }
.ct-resizer { position: relative; z-index: 2; width: 0; cursor: col-resize; outline: none; }
.ct-resizer::before { content: ''; position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; opacity: 0.6; transition: background 0.12s; }
.ct-resizer:hover::before, .ct-resizer:focus-visible::before { background: var(--blue); }
.ct-left { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); background: var(--bg); }
.ct-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--border); }
.ct-tab { flex: 1; padding: 7px 4px; font: inherit; font-size: 12px; font-weight: 500; color: var(--text-muted); background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; white-space: nowrap; }
.ct-tab:hover { color: var(--text); }
.ct-tab.active { color: var(--text); border-bottom-color: var(--blue); }
.ct-count.warning { background: var(--warning-text); color: var(--bg); }
.ct-collapse { flex-shrink: 0; width: 28px; font: inherit; font-size: 13px; color: var(--text-faint); background: none; border: none; cursor: pointer; }
.ct-collapse:hover { color: var(--text); }
.ct-collapse:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.ct-resizer.off { pointer-events: none; }
.ct-count { margin-left: 5px; padding: 0 5px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.ct-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ct-scroll { flex: 1; min-height: 0; overflow-y: auto; }
/* The last block fills the pane; toolbars above it (comparison switch) keep their height. */
.ct-pane > * { flex-shrink: 0; }
.ct-pane > :last-child { flex: 1; min-height: 0; }
.ct-center { min-width: 0; min-height: 0; padding-bottom: var(--sp-2); }
.ct-right { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--border); background: var(--bg); }
.ct-notes { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; max-height: 40%; overflow-y: auto; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.ct-widget { display: flex; flex-direction: column; gap: 4px; }
/* A remark inside the code must not read as another code line: raised card, blue frame, shadow. */
.ct-widget :deep(.it) {
  background: var(--bg3); border-top-color: var(--blue); border-right-color: var(--blue); border-bottom-color: var(--blue);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.ct-widget :deep(.it-summary) { font-weight: 500; }
.ct-badge { flex-shrink: 0; font-size: 10px; color: var(--text-muted); }
.plus { color: var(--diff-add); }
.minus { color: var(--diff-del); }
</style>
