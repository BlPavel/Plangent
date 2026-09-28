<template>
  <div class="terminals">
    <div v-if="terminals.length" class="strip">
      <div ref="tabsEl" class="tabs" role="tablist" @wheel="onWheel">
        <div
          v-for="t in terminals"
          :key="t.id"
          :data-id="t.id"
          class="tab"
          :class="{ active: selected === t.id, exited: t.exitCode !== undefined }"
          role="tab"
          :aria-selected="selected === t.id"
          :title="t.exitCode === undefined ? t.title : `${t.title} — процесс завершён (код ${t.exitCode})`"
          @mousedown.middle.prevent="close(t.id)"
          @click="selected = t.id"
          @dblclick="startRename(t.id)"
          @contextmenu.prevent="openMenu($event, { kind: 'tab', id: t.id })"
        >
          <span class="dot" />
          <input
            v-if="renameId === t.id"
            ref="renameEl"
            v-model="title"
            class="rename"
            @click.stop
            @dblclick.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renameId = ''"
            @blur="commitRename"
          />
          <span v-else class="tab-title">{{ t.title }}</span>
          <button class="tab-close" title="Закрыть (средняя кнопка мыши)" @click.stop="close(t.id)">
            <svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
        </div>
      </div>
      <div class="new" :class="{ split: shells.length > 1 }">
        <button class="new-btn" :disabled="creating" :title="`Новый терминал: ${shells[0]?.label ?? ''} (Ctrl+Shift+\`)`" @click="create()">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
        <button v-if="shells.length > 1" class="new-btn more" :disabled="creating" title="Выбрать оболочку" @click.stop="openMenu($event, { kind: 'shells' })">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4.5 6.5L8 10l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
    </div>

    <main class="body">
      <template v-if="current">
        <div v-if="current.exitCode !== undefined" class="exited-bar">
          <span>Процесс завершён · код {{ current.exitCode }}</span>
          <button class="btn btn-ghost btn-xs" @click="action(current.id, 'restart')">Перезапустить</button>
          <button class="btn btn-subtle btn-xs" @click="close(current.id)">Закрыть</button>
        </div>
        <TerminalPane :key="current.id + generation" :session-id="current.id" :show-header="false" :visible="visible" />
      </template>
      <div v-else-if="loaded" class="empty">
        <div class="open">
          <button class="btn btn-primary open-main" :disabled="creating" @click="create()">
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5L6.5 8 3 11.5M8 11.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            Открыть терминал
          </button>
          <button v-if="shells.length > 1" class="btn btn-primary btn-icon open-more" :disabled="creating" title="Выбрать оболочку" @click.stop="openMenu($event, { kind: 'shells' })">
            <svg viewBox="0 0 16 16" fill="none"><path d="M4.5 6.5L8 10l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <p class="empty-hint">{{ shells[0]?.label }}<template v-if="shells[0]"> · </template><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd></p>
      </div>
    </main>

    <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @pointerdown.stop>
      <template v-if="menu.kind === 'shells'">
        <div class="menu-label">Новый терминал</div>
        <button v-for="(s, i) in shells" :key="s.id" class="menu-item" @click="create(s.id)">
          {{ s.label }}<span v-if="i === 0" class="menu-note">по умолчанию</span>
        </button>
      </template>
      <template v-else>
        <button class="menu-item" @click="startRename(menu.id)">Переименовать</button>
        <button class="menu-item" @click="action(menu.id, 'restart')">Перезапустить</button>
        <button class="menu-item" @click="action(menu.id, 'clear')">Очистить</button>
        <div class="menu-sep" />
        <button class="menu-item" :disabled="terminals.length < 2" @click="closeOthers(menu.id)">Закрыть остальные</button>
        <button class="menu-item danger" @click="close(menu.id)">Закрыть</button>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
// Projects whose terminal was already auto-opened in this app session (module-level,
// so switching views doesn't reopen a terminal the user deliberately closed).
const autoOpened = new Set<string>()
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import TerminalPane from './TerminalPane.vue'

type Terminal = { id: string; title: string; exitCode?: number }
type Menu = { x: number; y: number } & ({ kind: 'shells' } | { kind: 'tab'; id: string })

const props = defineProps<{ projectId: string; visible: boolean }>()
const app = useAppStore()
const terminals = ref<Terminal[]>([])
const shells = ref<{ id: string; label: string }[]>([])
const selected = ref(''), creating = ref(false), generation = ref(0), loaded = ref(false)
const renameId = ref(''), title = ref('')
const menu = ref<Menu | null>(null)
const tabsEl = ref<HTMLElement>(), renameEl = ref<HTMLInputElement[]>()
const current = computed(() => terminals.value.find(t => t.id === selected.value))
let timer: ReturnType<typeof setInterval>

function fail(e: unknown) { app.toast(String(e), 'error') }

async function load() {
  try {
    const id = props.projectId
    const rows = await api.get<Terminal[]>(`/terminals?projectId=${id}`)
    if (props.projectId !== id) return
    terminals.value = rows
    loaded.value = true
    if (!rows.some(t => t.id === selected.value)) selected.value = rows[0]?.id ?? ''
  } catch (e) { fail(e) }
}
watch(() => props.projectId, () => { selected.value = ''; loaded.value = false; void load() }, { immediate: true })

// The first time the tab is shown for a project, open a terminal right away instead of
// an empty screen. After the user closes the last one we respect that and show the button.
watch([() => props.visible, loaded], ([visible, isLoaded]) => {
  if (!visible || !isLoaded || terminals.value.length || autoOpened.has(props.projectId)) return
  autoOpened.add(props.projectId)
  void create()
}, { immediate: true })

// Keep the active chip visible when it is selected from the keyboard or created off-screen.
watch(selected, id => nextTick(() => tabsEl.value?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })))

async function create(shell?: string) {
  menu.value = null
  if (creating.value) return
  creating.value = true
  try {
    const t = await api.post<Terminal>('/terminals', { projectId: props.projectId, shell })
    terminals.value.push(t)
    selected.value = t.id
  } catch (e) { fail(e) } finally { creating.value = false }
}

async function action(id: string, name: 'restart' | 'clear') {
  menu.value = null
  try { await api.post(`/terminals/${id}/${name}`); if (id === selected.value) generation.value++; await load() } catch (e) { fail(e) }
}

// Closing is optimistic: the neighbour to the right (or left) takes focus right away.
async function close(id: string) {
  menu.value = null
  const i = terminals.value.findIndex(t => t.id === id)
  if (i === -1) return
  terminals.value.splice(i, 1)
  if (selected.value === id) selected.value = (terminals.value[i] ?? terminals.value[i - 1])?.id ?? ''
  try { await api.delete(`/terminals/${id}`) } catch (e) { fail(e); await load() }
}
async function closeOthers(id: string) {
  for (const t of terminals.value.filter(t => t.id !== id)) await close(t.id)
  selected.value = id
}

function startRename(id: string) {
  const t = terminals.value.find(t => t.id === id)
  menu.value = null
  if (!t) return
  renameId.value = t.id; title.value = t.title
  void nextTick(() => { renameEl.value?.[0]?.focus(); renameEl.value?.[0]?.select() })
}
async function commitRename() {
  const id = renameId.value, value = title.value.trim()
  renameId.value = ''
  const t = terminals.value.find(t => t.id === id)
  if (!t || !value || value === t.title) return
  t.title = value
  try { await api.patch(`/terminals/${id}`, { title: value }) } catch (e) { fail(e); await load() }
}

function openMenu(e: MouseEvent, m: { kind: 'shells' } | { kind: 'tab'; id: string }) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // The shell menu drops down under the "˅" button; the tab menu opens at the cursor.
  const x = m.kind === 'shells' ? Math.min(r.left, window.innerWidth - 220) : Math.min(e.clientX, window.innerWidth - 200)
  menu.value = { ...m, x, y: m.kind === 'shells' ? r.bottom + 4 : e.clientY }
}

// Vertical wheel scrolls the chip strip sideways.
function onWheel(e: WheelEvent) {
  if (!tabsEl.value || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  tabsEl.value.scrollLeft += e.deltaY
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menu.value = null
  if (props.visible && e.ctrlKey && e.shiftKey && e.code === 'Backquote') { e.preventDefault(); void create() }
}
function onPointerDown() { menu.value = null }

onMounted(async () => {
  try { shells.value = await api.get('/terminals/shells') } catch (e) { fail(e) }
  timer = setInterval(load, 3000)
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('blur', onPointerDown)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('blur', onPointerDown)
})
</script>

<style scoped>
.terminals { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* Chip strip */
.strip { display: flex; align-items: center; gap: var(--sp-2); height: 44px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tabs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }

.tab { display: flex; align-items: center; gap: 8px; height: var(--size-sm); max-width: 220px; padding: 0 4px 0 10px; flex-shrink: 0; border: 1px solid transparent; border-radius: var(--radius); color: var(--text-muted); font-size: 12.5px; font-weight: 500; cursor: pointer; user-select: none; transition: background 0.1s, color 0.1s, border-color 0.1s; }
.tab:hover { background: var(--bg2); color: var(--text); }
.tab.active { background: var(--bg3); border-color: var(--border-strong); color: var(--text); }
.tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab.exited .tab-title { color: var(--text-faint); }

.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--accent-hover); }
.tab.exited .dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-faint); }

.tab-close { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; border-radius: 5px; color: var(--text-faint); cursor: pointer; opacity: 0; transition: opacity 0.1s, background 0.1s, color 0.1s; }
.tab-close svg { width: 12px; height: 12px; }
.tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: var(--bg-hover); color: var(--text); }

.rename { width: 130px; height: 20px; padding: 0 6px; background: var(--bg); border: 1px solid var(--blue); border-radius: 5px; color: var(--text); font: inherit; outline: none; }

/* "+" with an optional "˅" shell picker, joined like a split button */
.new { display: flex; flex-shrink: 0; }
.new-btn { height: var(--size-sm); width: var(--size-sm); display: inline-flex; align-items: center; justify-content: center; background: none; border: 1px solid transparent; border-radius: var(--radius); color: var(--text-muted); cursor: pointer; transition: background 0.1s, color 0.1s; }
.new-btn svg { width: 15px; height: 15px; }
.new-btn:not(:disabled):hover { background: var(--bg3); color: var(--text); }
.new-btn:disabled { opacity: 0.45; cursor: default; }
.new.split .new-btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.new-btn.more { width: 20px; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.new-btn.more svg { width: 12px; height: 12px; }

/* Body */
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.exited-bar { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-4); background: var(--warning-soft); border-bottom: 1px solid var(--border); font-size: 12px; color: var(--warning-text); flex-shrink: 0; }
.exited-bar span { margin-right: auto; }

.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); text-align: center; }
.open { display: flex; }
.open-main:has(+ .open-more) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.open-more { width: 30px; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-color: rgba(255, 255, 255, 0.25); }
.open-more:not(:disabled):hover { border-left-color: rgba(255, 255, 255, 0.25); }
.empty-hint { font-size: 11.5px; color: var(--text-faint); }
kbd { padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--bg2); font-family: inherit; font-size: 11px; }

/* Popup menu (tab context menu / shell picker) */
.menu { position: fixed; z-index: 100; min-width: 190px; padding: 4px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); display: flex; flex-direction: column; }
.menu-label { padding: 6px 10px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.menu-item { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); height: 30px; padding: 0 10px; background: none; border: none; border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.menu-item:not(:disabled):hover { background: var(--bg-hover); }
.menu-item:disabled { opacity: 0.4; cursor: default; }
.menu-item.danger { color: var(--danger-hover); }
.menu-note { font-size: 11px; color: var(--text-faint); }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--border); }
</style>
