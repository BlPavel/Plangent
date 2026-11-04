<template>
  <div class="terminals">
    <div v-if="terminals.length" class="strip" :class="{ compact }">
      <div ref="tabsEl" class="terminal-tabs" @wheel="onWheel">
        <AppTabs v-model="selected" rich :items="terminalTabItems" label="Терминалы" @tab-middle="close" @tab-dblclick="startRename" @tab-contextmenu="(id, event) => openMenu(event, { kind: 'tab', id })">
        <template #item="{ item }">
          <span class="dot" :class="{ exited: terminals.find(t => t.id === item.value)?.exitCode !== undefined }" />
          <AppInput
            v-if="renameId === item.value"
            ref="renameEl"
            v-model="title"
            class="rename"
            @click.stop
            @dblclick.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renameId = ''"
            @blur="commitRename"
          />
          <span v-else class="tab-title">{{ item.label }}</span>
          <AppButton variant="subtle" size="xs" icon title="Закрыть (средняя кнопка мыши)" aria-label="Закрыть терминал" @click.stop="close(item.value)">
            <svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </AppButton>
        </template>
        </AppTabs>
      </div>
      <div class="new" :class="{ split: shells.length > 1 }">
        <AppButton variant="subtle" size="xs" icon :disabled="creating" :title="`Новый терминал: ${shells[0]?.label ?? ''} (Ctrl+Shift+\`)`" @click="create()">
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </AppButton>
        <AppButton v-if="shells.length > 1" variant="subtle" size="xs" icon :disabled="creating" title="Выбрать оболочку" @click.stop="openMenu($event, { kind: 'shells' })">
          <UIIconChevron />
        </AppButton>
      </div>
    </div>

    <main class="body">
      <template v-if="current">
        <div v-if="current.exitCode !== undefined" class="exited-bar">
          <span>Процесс завершён · код {{ current.exitCode }}</span>
          <AppButton size="xs" @click="action(current.id, 'restart')">Перезапустить</AppButton>
          <AppButton variant="subtle" size="xs" @click="close(current.id)">Закрыть</AppButton>
        </div>
        <TerminalPane :key="current.id + generation" :session-id="current.id" :show-header="false" :visible="visible" />
      </template>
      <div v-else-if="loaded" class="empty">
        <div class="open">
          <AppButton variant="primary" :join="shells.length > 1 ? 'start' : undefined" :disabled="creating" @click="create()">
            <UIIconTerminal />
            Открыть терминал
          </AppButton>
          <AppButton v-if="shells.length > 1" variant="primary" join="end" icon :disabled="creating" title="Выбрать оболочку" @click.stop="openMenu($event, { kind: 'shells' })">
            <UIIconChevron />
          </AppButton>
        </div>
        <p class="empty-hint">{{ shells[0]?.label }}<template v-if="shells[0]"> · </template><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd></p>
      </div>
    </main>

    <AppPopover :model-value="!!menu" :at="menu" :min-width="190" role="menu" focus-on-open @update:model-value="!$event && (menu = null)">
      <template v-if="menu">
      <template v-if="menu.kind === 'shells'">
        <div class="menu-label">Новый терминал</div>
        <AppButton v-for="(s, i) in shells" :key="s.id" variant="subtle" size="sm" block role="menuitem" @click="create(s.id)">
          {{ s.label }}<span v-if="i === 0" class="menu-note">по умолчанию</span>
        </AppButton>
      </template>
      <template v-else>
        <AppButton variant="subtle" size="sm" block role="menuitem" @click="startRename(menu.id)">Переименовать</AppButton>
        <AppButton variant="subtle" size="sm" block role="menuitem" @click="action(menu.id, 'restart')">Перезапустить</AppButton>
        <AppButton variant="subtle" size="sm" block role="menuitem" @click="action(menu.id, 'clear')">Очистить</AppButton>
        <div class="menu-sep" />
        <AppButton variant="subtle" size="sm" block role="menuitem" :disabled="terminals.length < 2" @click="closeOthers(menu.id)">Закрыть остальные</AppButton>
        <AppButton variant="danger-link" size="sm" block role="menuitem" @click="close(menu.id)">Закрыть</AppButton>
      </template>
      </template>
    </AppPopover>
  </div>
</template>

<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import AppInput from '@shared/ui/AppInput.vue'
import AppPopover from '@shared/ui/AppPopover.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import { IconChevron as UIIconChevron, IconTerminal as UIIconTerminal } from '@shared/ui/icons'
import { terminalEndpoints } from '../api'

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useAppStore } from '@core/stores/app'
import TerminalPane from './TerminalPane.vue'

import type { Terminal, TerminalShell } from '@contracts'
type Menu = { x: number; y: number } & ({ kind: 'shells' } | { kind: 'tab'; id: string })

const props = defineProps<{ projectId: string; visible: boolean; compact?: boolean; /** Workspace whose folder new terminals open in and whose terminals are listed; null — the main place. */ workspaceId?: string | null }>()
const app = useAppStore()
const terminals = ref<Terminal[]>([])
const shells = ref<TerminalShell[]>([])
const selected = ref(''), creating = ref(false), generation = ref(0), loaded = ref(false)
const renameId = ref(''), title = ref('')
const menu = ref<Menu | null>(null)
const tabsEl = ref<HTMLElement>(), renameEl = ref<InstanceType<typeof AppInput>>()
const current = computed(() => terminals.value.find(t => t.id === selected.value))
const terminalTabItems = computed(() => terminals.value.map(t => ({ value: t.id, label: t.title, title: t.exitCode === undefined ? t.title : `${t.title} — процесс завершён (код ${t.exitCode})` })))
let timer: ReturnType<typeof setInterval>

function fail(e: unknown) { app.toast(String(e), 'error') }

async function load() {
  try {
    const id = props.projectId
    const rows = await terminalEndpoints.getTerminals({ params: {  }, query: Object.fromEntries(new URLSearchParams("projectId=" + id + "&workspace=" + encodeURIComponent(props.workspaceId ?? ''))) })
    if (props.projectId !== id) return
    terminals.value = rows
    loaded.value = true
    if (!rows.some(t => t.id === selected.value)) selected.value = rows[0]?.id ?? ''
  } catch (e) { fail(e) }
}
watch(() => [props.projectId, props.workspaceId], () => { selected.value = ''; loaded.value = false; void load() }, { immediate: true })

// Open a terminal when entering an empty tab, after the project's sessions are loaded.
// Closing the last terminal keeps the tab empty until the user returns to it.
watch([() => props.visible, loaded], ([visible, isLoaded]) => {
  if (!visible || !isLoaded || terminals.value.length) return
  void create()
}, { immediate: true })

// Keep the active chip visible when it is selected from the keyboard or created off-screen.
watch(selected, id => nextTick(() => tabsEl.value?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })))

async function create(shell?: string) {
  menu.value = null
  if (creating.value) return
  creating.value = true
  try {
    const t = await terminalEndpoints.postTerminals({ params: {  }, body: { projectId: props.projectId, shell, workspaceId: props.workspaceId ?? null } })
    terminals.value.push(t)
    selected.value = t.id
  } catch (e) { fail(e) } finally { creating.value = false }
}

async function action(id: string, name: 'restart' | 'clear') {
  menu.value = null
  try { await terminalEndpoints.postTerminalsByIdByAction({ params: { id: id, action: name } }); if (id === selected.value) generation.value++; await load() } catch (e) { fail(e) }
}

// Closing is optimistic: the neighbour to the right (or left) takes focus right away.
async function close(id: string) {
  menu.value = null
  const i = terminals.value.findIndex(t => t.id === id)
  if (i === -1) return
  terminals.value.splice(i, 1)
  if (selected.value === id) selected.value = (terminals.value[i] ?? terminals.value[i - 1])?.id ?? ''
  try { await terminalEndpoints.deleteTerminalsById({ params: { id: id } }) } catch (e) { fail(e); await load() }
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
  void nextTick(() => { renameEl.value?.focus(); renameEl.value?.select() })
}
async function commitRename() {
  const id = renameId.value, value = title.value.trim()
  renameId.value = ''
  const t = terminals.value.find(t => t.id === id)
  if (!t || !value || value === t.title) return
  t.title = value
  try { await terminalEndpoints.patchTerminalsById({ params: { id: id }, body: { title: value } }) } catch (e) { fail(e); await load() }
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
  try { shells.value = await terminalEndpoints.getTerminalsShells({ params: {  } }) } catch (e) { fail(e) }
  timer = setInterval(load, 3000)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', onPointerDown)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', onPointerDown)
})
</script>

<style scoped>
.terminals { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* Chip strip */
.strip { display: flex; align-items: center; gap: var(--sp-2); height: 44px; padding: 0 var(--sp-3); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.strip.compact { height: 36px; }
.terminal-tabs { min-width: 0; overflow-x: auto; scrollbar-width: none; }
.terminal-tabs::-webkit-scrollbar { display: none; }

.tab { display: flex; align-items: center; gap: 8px; height: var(--size-sm); max-width: 220px; padding: 0 4px 0 10px; flex-shrink: 0; border: 1px solid transparent; border-radius: var(--radius); color: var(--text-muted); font-size: var(--fs-md); font-weight: 500; cursor: pointer; user-select: none; transition: background var(--motion-instant), color var(--motion-instant), border-color var(--motion-instant); }
.tab:hover { background: var(--bg2); color: var(--text); }
.tab.active { background: var(--bg3); border-color: var(--border-strong); color: var(--text); }
.tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab.exited .tab-title { color: var(--text-faint); }

.dot { width: 7px; height: 7px; border-radius: var(--radius-round); flex-shrink: 0; background: var(--accent-hover); }
.dot.exited { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-faint); }

.tab-close { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; border-radius: var(--radius-5); color: var(--text-faint); cursor: pointer; opacity: 0; transition: opacity var(--motion-instant), background var(--motion-instant), color var(--motion-instant); }
.tab-close svg { width: 12px; height: 12px; }
.tab:hover .tab-close, .tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: var(--bg-hover); color: var(--text); }

.rename { flex: 0 0 130px; }

/* "+" with an optional "˅" shell picker, joined like a split button */
.new { display: flex; flex-shrink: 0; }
.new-btn { height: var(--size-sm); width: var(--size-sm); display: inline-flex; align-items: center; justify-content: center; background: none; border: 1px solid transparent; border-radius: var(--radius); color: var(--text-muted); cursor: pointer; transition: background var(--motion-instant), color var(--motion-instant); }
.new-btn svg { width: 15px; height: 15px; }
.new-btn:not(:disabled):hover { background: var(--bg3); color: var(--text); }
.new-btn:disabled { opacity: 0.45; cursor: default; }
.new.split .new-btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.new-btn.more { width: 20px; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.new-btn.more svg { width: 12px; height: 12px; }

/* Body */
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.exited-bar { display: flex; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-4); background: var(--warning-soft); border-bottom: 1px solid var(--border); font-size: var(--fs-sm); color: var(--warning-text); flex-shrink: 0; }
.exited-bar span { margin-right: auto; }

.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2); text-align: center; }
.open { display: flex; }
.open-main:has(+ .open-more) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.open-more { width: 30px; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-color: var(--divider-light); }
.open-more:not(:disabled):hover { border-left-color: var(--divider-light); }
.empty-hint { font-size: var(--fs-sm); color: var(--text-faint); }
kbd { padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-4); background: var(--bg2); font-family: inherit; font-size: var(--fs-xs); }

/* Popup menu (tab context menu / shell picker) */
.menu { position: fixed; z-index: var(--z-modal); min-width: 190px; padding: 4px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); display: flex; flex-direction: column; }
.menu-label { padding: 6px 10px 4px; font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.menu-item { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); height: 30px; padding: 0 10px; background: none; border: none; border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: var(--fs-md); text-align: left; cursor: pointer; }
.menu-item:not(:disabled):hover { background: var(--bg-hover); }
.menu-item:disabled { opacity: 0.4; cursor: default; }
.menu-item.danger { color: var(--danger-hover); }
.menu-note { font-size: var(--fs-xs); color: var(--text-faint); }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--border); }
</style>
