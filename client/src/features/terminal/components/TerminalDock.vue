<template>
  <div class="dock-wrap">
    <section v-if="open && shown" class="dock" :style="{ height: height + 'px' }" aria-label="Терминал">
      <div class="dock-resizer" role="separator" aria-orientation="horizontal" aria-label="Высота терминала" title="Потяните, чтобы изменить высоту" @pointerdown="startResize" />
      <header class="dock-head">
        <span class="dock-place" :title="shown.workspaceId ? 'Папка этой работы' : 'Основная папка проекта'">⌨ {{ shown.label }}</span>
        <button v-if="other" type="button" class="dock-link" @click="other = null">← вернуться: {{ context?.label }}</button>
        <span class="dock-spacer" />
        <button type="button" class="dock-close" title="Скрыть (Ctrl+`)" aria-label="Скрыть терминал" @click="open = false">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </header>
      <p v-if="shown.blocked" class="dock-blocked">{{ shown.blocked }}</p>
      <TerminalsView v-else :key="shown.projectId + ':' + (shown.workspaceId ?? '')" class="dock-body" :project-id="shown.projectId" :workspace-id="shown.workspaceId" :visible="open" />
    </section>
    <footer class="status">
      <span class="status-spacer" />
      <button
        v-for="r in runningElsewhere" :key="r.workspaceId ?? 'main'" type="button" class="status-run"
        :title="'Запущено: ' + r.processes.join(', ') + ' — открыть этот терминал'" @click="showPlace(r)"
      >▶ {{ r.label }}</button>
      <button type="button" class="status-toggle" :class="{ on: open }" :disabled="!context" :title="context ? 'Терминал: ' + context.label + ' (Ctrl+`)' : 'Выберите проект'" @click="open = !open">
        <svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5L6.5 8 3 11.5M8 11.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Терминал<span v-if="runningHere" class="status-dot" title="Здесь что-то запущено" />
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '@core/api'
import TerminalsView from './TerminalsView.vue'

/** Where terminals open: a work's own folder, else the project's main folder; `blocked` — not available yet. */
export interface TerminalPlace { projectId: string; workspaceId: string | null; label: string; blocked?: string }
const props = defineProps<{ context: TerminalPlace | null; /** names a project's folder: the work it belongs to, else «основная папка» */ placeLabel: (projectId: string, workspaceId: string | null) => string }>()

const open = ref(localStorage.getItem('terminal.dock.open') === '1')
const height = ref(Math.min(900, Math.max(140, Number(localStorage.getItem('terminal.dock.height')) || 300)))
watch(open, value => localStorage.setItem('terminal.dock.open', value ? '1' : '0'))
watch(height, value => localStorage.setItem('terminal.dock.height', String(value)))
/** Another place opened from «▶ запущено»: shown until the developer returns or goes to another screen. */
const other = ref<TerminalPlace | null>(null)
watch(() => props.context && props.context.projectId + ':' + props.context.workspaceId, () => { other.value = null })
const shown = computed(() => other.value ?? props.context)

// Where something runs in the project's terminals (an app, a watcher): one look at the processes every few seconds.
type Running = { id: string; title: string; workspaceId: string | null; processes: { name: string }[] }
const running = ref<Running[]>([])
let timer: ReturnType<typeof setInterval> | undefined, version = 0
async function poll() {
  const projectId = props.context?.projectId
  const mine = ++version
  if (!projectId || document.hidden) { if (!projectId) running.value = []; return }
  try {
    const rows = await api.get<Running[]>('/terminals/running?projectId=' + encodeURIComponent(projectId))
    if (mine === version) running.value = rows
  } catch { /* the indicator is best-effort */ }
}
watch(() => props.context?.projectId, () => { running.value = []; void poll() }, { immediate: true })
const places = computed(() => {
  const map = new Map<string, { workspaceId: string | null; processes: string[] }>()
  for (const r of running.value) {
    const key = r.workspaceId ?? ''
    const place = map.get(key) ?? { workspaceId: r.workspaceId ?? null, processes: [] }
    place.processes.push(...r.processes.map(p => p.name))
    map.set(key, place)
  }
  return [...map.values()]
})
const here = (workspaceId: string | null) => (shown.value?.workspaceId ?? null) === workspaceId
const runningHere = computed(() => places.value.some(p => here(p.workspaceId)))
const runningElsewhere = computed(() => !props.context ? [] : places.value.filter(p => !here(p.workspaceId))
  .map(p => ({ ...p, processes: [...new Set(p.processes)], label: props.placeLabel(props.context!.projectId, p.workspaceId) })))
function showPlace(place: { workspaceId: string | null; label: string }) {
  if (!props.context) return
  const back = (props.context.workspaceId ?? null) === place.workspaceId
  other.value = back ? null : { projectId: props.context.projectId, workspaceId: place.workspaceId, label: place.label }
  open.value = true
}

function startResize(event: PointerEvent) {
  const startY = event.clientY, start = height.value
  const move = (e: PointerEvent) => { height.value = Math.min(window.innerHeight - 160, Math.max(140, start + startY - e.clientY)) }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.style.userSelect = '' }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
// Ctrl+` shows and hides the panel, as in VS Code (Ctrl+Shift+` opens a new terminal inside it).
function onKey(event: KeyboardEvent) {
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.code === 'Backquote' && props.context) { event.preventDefault(); open.value = !open.value }
}
onMounted(() => { timer = setInterval(() => void poll(), 8000); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('keydown', onKey) })
</script>

<style scoped>
.dock-wrap { flex-shrink: 0; display: flex; flex-direction: column; }
.dock { position: relative; display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--border-strong); background: var(--bg); }
.dock-resizer { position: absolute; top: -3px; left: 0; right: 0; height: 6px; cursor: row-resize; z-index: 2; }
.dock-resizer:hover { background: var(--blue); opacity: 0.6; }
.dock-head { display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; font-size: 12px; }
.dock-place { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-weight: 500; }
.dock-link { padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; white-space: nowrap; }
.dock-spacer { flex: 1; }
.dock-close { width: 22px; height: 22px; display: grid; place-items: center; background: none; border: none; border-radius: 5px; color: var(--text-muted); cursor: pointer; }
.dock-close:hover { background: var(--bg3); color: var(--text); }
.dock-close svg { width: 14px; height: 14px; }
.dock-blocked { padding: 16px; font-size: 13px; color: var(--text-muted); }
.dock-body { flex: 1; min-height: 0; }
.dock-body :deep(.strip) { height: 36px; }
.status { display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; border-top: 1px solid var(--border); background: var(--bg2); font-size: 12px; }
.status-spacer { flex: 1; }
.status-run { max-width: 260px; height: 20px; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: inherit; font-size: 11.5px; color: var(--accent-hover); background: none; border: none; border-radius: 4px; cursor: pointer; }
.status-run:hover { background: var(--bg3); }
.status-toggle { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: none; border-radius: 4px; cursor: pointer; }
.status-toggle svg { width: 13px; height: 13px; }
.status-toggle:hover:not(:disabled), .status-toggle.on { background: var(--bg3); color: var(--text); }
.status-toggle:disabled { opacity: 0.45; cursor: default; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-hover); }
</style>
