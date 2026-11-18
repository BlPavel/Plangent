<template>
  <div class="csp" tabindex="-1" @keydown="onKey">
    <template v-if="!place.blocked && active">
      <div class="csp-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина колонки файла" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'file')" @dblclick="fileWidth = FILE_DEFAULT" @keydown="resizeKey($event, 'file')" />
      <section class="csp-file" :style="{ width: fileWidth + 'px' }" aria-label="Открытый файл">
        <CodeFileTabs :files="state.files" :active="state.active" :statuses="statuses" @select="activate" @close="closeFile" @close-all="closeAll" />
        <FileViewer ref="viewer" v-model:mode="mode" class="csp-viewer" :project-id="place.projectId" @select="selectLines">
          <template #notes="{ path }">
            <div v-if="selection && selection.path === path" class="csp-sel">
              <span class="csp-sel-text">{{ selection.start === selection.end ? 'Выделена строка ' + selection.start : `Выделено строки ${selection.start}–${selection.end}` }}</span>
              <span class="csp-chip" draggable="true" title="Перетащите в поле сообщения" @dragstart="dragMention($event, selection.path, false, selection.start, selection.end)">
                <span class="csp-grip" aria-hidden="true">⋮⋮</span><code>{{ selectionMention }}</code>
              </span>
              <span class="csp-sel-grow" />
              <AppButton variant="subtle" size="xs" title="Вставить в последний чат, где вы печатали" @click="toChat">В чат</AppButton>
              <AppButton variant="subtle" size="xs" icon title="Снять выделение" aria-label="Снять выделение" @click="clearSelection">✕</AppButton>
            </div>
          </template>
        </FileViewer>
      </section>
    </template>

    <div class="csp-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина колонки списка" title="Потяните, чтобы изменить ширину; двойной клик — сбросить" tabindex="0" @pointerdown="startResize($event, 'list')" @dblclick="listWidth = LIST_DEFAULT" @keydown="resizeKey($event, 'list')" />
    <aside class="csp-list" :style="{ width: listWidth + 'px' }" aria-label="Код">
      <header class="csp-head">
        <span class="csp-place" :title="place.workspaceId ? 'Ветка этой работы' : 'Основная папка проекта'">{{ place.label }}</span>
        <AppButton variant="link" size="xs" title="Открыть в полноценном режиме: с замечаниями и коммитами" @click="emit('open-in-code', { path: state.active, line: selection?.path === state.active ? selection.start : null, mode, base: code.base, round: baseArg })">Открыть в Коде ↗</AppButton>
      </header>
      <div class="csp-tabs">
        <AppTabs shrink :model-value="state.list" :items="listTabs" label="Код" bare @update:model-value="selectList($event as SideListTab)" />
        <AppButton variant="subtle" size="xs" icon title="Скрыть (Ctrl+Shift+E)" aria-label="Скрыть код" @click="emit('close')">»</AppButton>
      </div>
      <p v-if="place.blocked" class="csp-blocked">{{ place.blocked }}</p>
      <template v-else>
        <div v-show="state.list === 'changes'" class="csp-pane">
          <BaseSwitcher />
          <ChangesList :changes="code.shownChanges" :stats="code.shownStats" :selected="code.selectedPath" :empty-text="emptyText" @open="change => open(change.path, 'diff')" />
        </div>
        <div v-show="state.list === 'files'" class="csp-pane">
          <FileTree draggable @drag-path="dragMention"
            ref="tree" :trees="code.trees" :selected="code.selectedPath" :show-ignored="code.includeIgnored"
            @load="code.loadTree($event)" @select="open($event, 'file')" @update:show-ignored="code.setIncludeIgnored($event)"
          />
        </div>
        <div v-show="state.list === 'search'" class="csp-pane">
          <SearchPanel ref="search" @open="openFound" />
        </div>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { mentionText, type MentionDrag } from '@features/agent-chat'
import { useMentionDrag } from '../composables/useMentionDrag'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import { FileTree, type LineSelection } from '@shared/code-viewer'
import { useCodeStore, type CompareBase } from '../stores/code'
import { useGitStore } from '../stores/git'
import { provideCodeStores } from '../stores/context'
import { useSidePanelStore, type SideListTab } from '../stores/side-panel'
import BaseSwitcher from './BaseSwitcher.vue'
import ChangesList from './ChangesList.vue'
import CodeFileTabs from './CodeFileTabs.vue'
import FileViewer from './FileViewer.vue'
import SearchPanel from './SearchPanel.vue'

/** The place the panel shows: a work's own folder, else the project's main folder; `blocked` — not available yet. */
export interface CodePlace { projectId: string; workspaceId: string | null; label: string; blocked?: string }
export interface OpenInCode { path: string | null; line: number | null; mode: 'diff' | 'file'; base: CompareBase; round: string | null }

const props = defineProps<{ place: CodePlace }>()
const emit = defineEmits<{ close: []; 'open-in-code': [target: OpenInCode]; 'to-chat': [mention: MentionDrag] }>()

// The panel works with its own stores, so «Код» of the project and the panel never stop each other.
const code = useCodeStore('side')
const git = useGitStore('side')
provideCodeStores(code, git)
const dragMention = useMentionDrag(code)
const panels = useSidePanelStore()
const state = computed(() => panels.place(props.place.projectId, props.place.workspaceId))
const active = computed(() => state.value.files.find(file => file.path === state.value.active) ?? null)
const mode = computed({
  get: () => active.value?.mode ?? 'file',
  set: value => { if (active.value) active.value.mode = value },
})
const baseArg = computed(() => (code.base === 'remote' ? code.remoteRef : code.baseRound))

const viewer = ref<InstanceType<typeof FileViewer>>()
const tree = ref<InstanceType<typeof FileTree>>()
const search = ref<InstanceType<typeof SearchPanel>>()

const listTabs = computed(() => [
  { value: 'changes', label: 'Изменения', count: code.shownChanges.length },
  { value: 'files', label: 'Файлы' },
  { value: 'search', label: 'Поиск' },
])
const statuses = computed(() => Object.fromEntries(code.shownChanges.map(change => [change.path, change.status])))
const emptyText = computed(() => {
  if (!code.repository) return 'Папка не под git — изменений нет'
  if (code.effectiveBase === 'review') return 'В ревью не вошло ни одного файла'
  if (code.effectiveBase === 'remote') return `Нет отличий от ${code.remoteRef}`
  if (code.effectiveBase === 'agent') return 'После последнего раунда агент ничего не менял'
  return 'Нет изменений для коммита'
})

// --- selected lines: a chip to drag into a message, or send to the chat ---
const selection = ref<{ path: string; start: number; end: number } | null>(null)
const selectionMention = computed(() => selection.value
  ? mentionText({ projectId: props.place.projectId, workspaceId: props.place.workspaceId, path: selection.value.path, dir: false, startLine: selection.value.start, endLine: selection.value.end })
  : '')
/** Lines of the removed side are not in the file on disk, so only the new side can be mentioned. */
function selectLines(lines: LineSelection) {
  if (lines.side !== 'new') { clearSelection(); return }
  selection.value = { path: lines.path, start: lines.startLine, end: lines.endLine }
}
function clearSelection() { selection.value = null; viewer.value?.clearSelection() }
function toChat() {
  const lines = selection.value
  if (!lines) return
  emit('to-chat', { projectId: props.place.projectId, workspaceId: props.place.workspaceId, path: lines.path, dir: false, startLine: lines.start, endLine: lines.end })
}
watch(() => state.value.active, () => { selection.value = null })

// --- the place: the stores follow it, the open files come back from the panel's memory ---
/** False while the stores restart: they empty the selection, which must not close the remembered tab. */
let ready = false
let turn = 0
async function begin() {
  const mine = ++turn
  ready = false
  code.stop(); git.stop()
  if (props.place.blocked) return
  const { projectId, workspaceId } = props.place
  const remembered = state.value
  void git.start(projectId, workspaceId ?? undefined)
  await code.start(projectId, workspaceId ?? undefined)
  if (mine !== turn) return
  if (remembered.base !== 'head') await code.setBase(remembered.base, remembered.baseRound)
  if (mine !== turn) return
  if (remembered.active) await activate(remembered.active, mine)
  if (mine === turn) ready = true
}
watch(() => [props.place.projectId, props.place.workspaceId, !!props.place.blocked], () => { void begin() }, { immediate: true })
onBeforeUnmount(() => { turn++; ready = false; code.stop(); git.stop() })

// The comparison belongs to the place too.
watch(() => [code.base, baseArg.value] as const, ([base, round]) => {
  if (!ready) return
  state.value.base = base; state.value.baseRound = round
})
// A file which disappeared from the disk closes its tab on the next refresh.
watch(() => code.selectedPath, path => {
  if (ready && path === null && state.value.active) void closeFile(state.value.active)
})

/** Switches to the file's tab; a file which is gone (not even in the changes) closes it. */
async function activate(path: string, mine = turn) {
  state.value.active = path
  await code.selectFile(path)
  if (mine !== turn || code.selectedPath !== path) return
  if (!code.file && !code.shownChanges.some(change => change.path === path)) await closeFile(path)
}
async function open(path: string, as: 'diff' | 'file', line?: number) {
  panels.open(state.value, path, as)
  if (code.selectedPath !== path) await activate(path)
  if (line) {
    // The viewer mounts one tick after the file arrives.
    await nextTick(); await nextTick()
    await viewer.value?.scrollToLine(line)
  }
}
async function closeFile(path: string) {
  const wasActive = state.value.active === path
  panels.close(state.value, path)
  if (!wasActive) return
  if (state.value.active) await activate(state.value.active)
  else await code.selectFile(null)
}
async function closeAll() {
  panels.closeAll(state.value)
  await code.selectFile(null)
}
/** A search hit: a line opens the file there; a file found by name opens like in the changes list. */
const openFound = (path: string, line?: number) => open(path, line || !code.changes.some(change => change.path === path) ? 'file' : 'diff', line)
async function selectList(tab: SideListTab) {
  state.value.list = tab
  if (tab === 'files') { await nextTick(); if (code.selectedPath) tree.value?.reveal(code.selectedPath) }
  if (tab === 'search') { await nextTick(); search.value?.focus() }
}

// Ctrl+F belongs to the panel only while the focus is inside it.
function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && (event.code || '') === 'KeyF' && active.value) {
    event.preventDefault()
    void viewer.value?.openFind()
  }
}

// --- column widths, remembered between visits ---
const LIST_DEFAULT = 280, FILE_DEFAULT = 520
const LIMITS = { list: [240, 460], file: [360, 1000] } as const
const clamp = (side: 'list' | 'file', value: number) => Math.min(LIMITS[side][1], Math.max(LIMITS[side][0], Math.round(value)))
const stored = (key: string, side: 'list' | 'file', fallback: number) => clamp(side, Number(localStorage.getItem(key)) || fallback)
const listWidth = ref(stored('code.side.listWidth', 'list', LIST_DEFAULT))
const fileWidth = ref(stored('code.side.fileWidth', 'file', FILE_DEFAULT))
watch(listWidth, value => localStorage.setItem('code.side.listWidth', String(value)))
watch(fileWidth, value => localStorage.setItem('code.side.fileWidth', String(value)))
function setWidth(side: 'list' | 'file', value: number) {
  if (side === 'list') listWidth.value = clamp(side, value)
  else fileWidth.value = clamp(side, value)
}
function startResize(event: PointerEvent, side: 'list' | 'file') {
  const startX = event.clientX, start = side === 'list' ? listWidth.value : fileWidth.value
  const move = (e: PointerEvent) => setWidth(side, start + startX - e.clientX)
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.style.userSelect = '' }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
function resizeKey(event: KeyboardEvent, side: 'list' | 'file') {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  setWidth(side, (side === 'list' ? listWidth.value : fileWidth.value) + (event.key === 'ArrowLeft' ? 16 : -16))
}

defineExpose({ open })
</script>

<style scoped>
/* The panel starts below the title bar, which stays one even strip with the window buttons. */
.csp { display: flex; margin-top: var(--titlebar-h); flex-shrink: 1; min-width: 0; min-height: 0; outline: none; background: var(--bg2); }
.csp-resizer { position: relative; z-index: var(--z-local-raised); width: 0; flex-shrink: 0; border-left: 1px solid var(--border); cursor: col-resize; outline: none; }
.csp-resizer::before { content: ''; position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; opacity: 0.6; transition: background var(--motion-fast); }
.csp-resizer:hover::before, .csp-resizer:focus-visible::before { background: var(--blue); }
.csp-file { display: flex; flex-direction: column; flex-shrink: 1; min-width: 280px; min-height: 0; background: var(--bg); }
.csp-viewer { flex: 1; min-height: 0; }
.csp-sel { display: flex; align-items: center; gap: 8px; flex-shrink: 0; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--border); background: var(--blue-soft); font-size: var(--fs-sm); color: var(--text-muted); }
.csp-sel-text { white-space: nowrap; }
.csp-sel-grow { flex: 1; }
.csp-chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 22px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: var(--bg3); color: var(--text); cursor: grab; user-select: none; }
.csp-chip:hover { border-color: var(--blue); }
.csp-grip { color: var(--text-faint); letter-spacing: -2px; }
.csp-chip code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--blue-hover); }
.csp-list { display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; background: var(--bg2); }
.csp-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; height: 28px; padding: 0 4px 0 12px; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
.csp-place { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-weight: var(--fw-medium); }
.csp-tabs { display: flex; align-items: center; flex-shrink: 0; padding-right: 4px; border-bottom: 1px solid var(--border); }
.csp-tabs > :first-child { flex: 1; min-width: 0; }
.csp-blocked { padding: 16px; font-size: var(--fs-md); color: var(--text-muted); }
.csp-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* The last block fills the pane; the comparison switch above it keeps its height. */
.csp-pane > * { flex-shrink: 0; }
.csp-pane > :last-child { flex: 1; min-height: 0; }
</style>
