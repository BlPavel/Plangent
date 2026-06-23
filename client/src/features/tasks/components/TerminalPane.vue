<template>
  <div
    class="terminal-wrap"
    ref="wrapEl"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="terminal-header">
      <span class="session-label">{{ label || sessionId }}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" @click="$emit('detach')">Свернуть</button>
        <button class="btn btn-danger btn-sm" @click="$emit('kill')">Завершить</button>
      </div>
    </div>

    <div class="terminal-body" ref="termEl" @click="focusTerm" />

    <!-- Drop overlay -->
    <div v-if="dragging" class="drop-overlay">
      <span>Отпустите файл — путь вставится в терминал</span>
    </div>

    <!-- Upload progress -->
    <div v-if="uploading" class="upload-status">Загрузка изображения...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { platform } from '@core/platform'

const props = defineProps<{ sessionId: string; label?: string; visible?: boolean }>()
const emit = defineEmits<{ detach: []; kill: []; input: [text: string] }>()

const wrapEl = ref<HTMLElement>()
const termEl = ref<HTMLElement>()
const dragging = ref(false)
const uploading = ref(false)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

// Whether the running program (shell / agent CLI) has bracketed paste enabled.
// We track it by watching the PTY output for the DECSET 2004 enable/disable codes.
let bracketedPaste = false

function trackBracketedPaste(data: string) {
  const on = data.lastIndexOf('\x1b[?2004h')
  const off = data.lastIndexOf('\x1b[?2004l')
  if (on !== -1 || off !== -1) bracketedPaste = on > off
}

// Focus the terminal when its body is clicked.
function focusTerm() {
  term?.focus()
}

// Send text directly into the running PTY
function sendRaw(text: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: text }))
  } else {
    emit('input', text)
  }
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|avif|ico)$/i
function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p)
}

// Insert filesystem paths into the running program the way a real terminal does.
// When bracketed paste is on (Claude Code and other agent CLIs enable it):
//   - Images: wrap in the paste markers so the agent attaches them (shows
//     "[Image #N]") and reads the real picture instead of a placeholder.
//   - Documents / folders: a bracketed-paste path gets swallowed by the agent —
//     nothing shows in the input. Send the path as plain typed text instead so
//     the FULL path is visible and the user can see exactly what was pasted.
// At a plain shell prompt we fall back to shell-escaped paths.
function insertPaths(paths: string[]) {
  if (paths.length === 0) return
  if (bracketedPaste) {
    for (const p of paths) {
      if (isImagePath(p)) sendRaw(`\x1b[200~${p}\x1b[201~ `)
      else sendRaw(p + ' ')
    }
  } else {
    sendRaw(paths.map(shellQuote).join(' ') + ' ')
  }
  term?.focus()
}

function syncSize() {
  if (!term || !fitAddon) return
  if (!termEl.value || termEl.value.clientWidth === 0) return
  fitAddon.fit()
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
  }
}

function connectWs() {
  if (!props.sessionId) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/ws/pty?session=${encodeURIComponent(props.sessionId)}`
  ws = new WebSocket(url)

  ws.onopen = () => {
    // CRITICAL: tell PTY the real terminal size on connect
    syncSize()
  }
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'data') {
      if (typeof msg.data === 'string') trackBracketedPaste(msg.data)
      term?.write(msg.data)
    }
    else if (msg.type === 'exit') term?.writeln(`\r\n\x1b[33m[Процесс завершён: код ${msg.exitCode}]\x1b[0m`)
    else if (msg.type === 'error') term?.writeln(`\r\n\x1b[31m[Ошибка: ${msg.message}]\x1b[0m`)
  }
  ws.onerror = () => term?.writeln('\r\n\x1b[31m[Ошибка соединения]\x1b[0m')
  ws.onclose = () => term?.writeln('\r\n\x1b[33m[Соединение закрыто]\x1b[0m')
}

function initTerminal() {
  if (!termEl.value) return

  term = new Terminal({
    theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3', cursorAccent: '#0d1117' },
    fontFamily: '"Cascadia Code", "JetBrains Mono", "Menlo", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    // Don't set cols/rows here — FitAddon will calculate the right values
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(termEl.value)

  // Fit only if visible — if mounted while hidden (v-show=false), skip and let
  // the visible watcher handle it when the panel is shown for the first time.
  if (termEl.value.clientWidth > 0) fitAddon.fit()

  // Keyboard input goes straight to PTY — this is how @ and all native features work
  term.onData(data => sendRaw(data))

  // ResizeObserver handles panel drag resize (window.resize misses those)
  resizeObserver = new ResizeObserver(() => syncSize())
  resizeObserver.observe(termEl.value)

  connectWs()

  // Intercept paste in the CAPTURE phase. When the terminal is focused the paste
  // event lands on xterm's hidden <textarea>, and xterm's own handler calls
  // stopPropagation() — so a bubbling listener on wrapEl never fires. Capture runs
  // top-down (wrapEl before the textarea), letting us see the paste first.
  wrapEl.value?.addEventListener('paste', onPaste, true)
}

// ── Paste from Finder (Cmd+C → Cmd+V) ───────────────────────────────────────

async function onPaste(e: ClipboardEvent) {
  const cd = e.clipboardData
  if (!cd) return

  // Does the clipboard hold a file (vs. plain text)? A file copied in Finder may
  // arrive as cd.files, as an image/* item (often just the file's ICON), or only
  // as a "Files" type with everything else empty — so check all three.
  const hasImageItem = Array.from(cd.items).some(
    i => i.kind === 'file' && i.type.startsWith('image/')
  )
  const looksLikeFile =
    (cd.files && cd.files.length > 0) || hasImageItem || cd.types.includes('Files')

  // Plain text paste → let xterm deliver it to the PTY untouched.
  if (!looksLikeFile) return

  // Stop the default paste NOW (before any await) so xterm doesn't also dump the
  // clipboard's text/icon into the prompt.
  e.preventDefault()
  e.stopPropagation()
  uploading.value = true
  try {
    // 1. Real filesystem path of the copied file, from the native pasteboard.
    //    webUtils.getPathForFile returns '' for clipboard pastes, and the macOS
    //    icon-thumbnail is what makes the agent see a placeholder — so we resolve
    //    the actual path first. The platform bridge handles Electron vs. the
    //    server-route fallback in plain-browser mode.
    const paths = await platform.getClipboardFilePaths()
    if (paths.length > 0) {
      insertPaths(paths)
      return
    }

    // 2. No file URL on the pasteboard → a genuine screenshot / clipboard image.
    const imageItem = Array.from(cd.items).find(
      i => i.kind === 'file' && i.type.startsWith('image/')
    )
    const file = imageItem?.getAsFile()
    if (file) await uploadImageAndInsert(file)
    else term?.writeln('\r\n\x1b[33m[Не удалось определить путь к файлу]\x1b[0m')
  } catch {
    term?.writeln('\r\n\x1b[31m[Ошибка чтения буфера обмена]\x1b[0m')
  } finally {
    uploading.value = false
  }
}

// Upload a real clipboard image (screenshot) to a temp file and insert its path.
async function uploadImageAndInsert(file: File) {
  const ext = file.type.split('/')[1] ?? 'png'
  const base64 = await fileToBase64(file)
  const res = await fetch('/api/upload-temp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: base64, name: `screenshot.${ext}` }),
  })
  const { path } = await res.json() as { path: string }
  insertPaths([path])
}

// ── Drag-and-drop from Finder ────────────────────────────────────────────────

async function onDrop(e: DragEvent) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])

  // Native: real filesystem paths (null in plain browser → falls through to uri-list)
  if (files.length > 0) {
    const paths = files.map(f => platform.getFilePath(f)).filter((p): p is string => !!p)
    if (paths.length > 0) {
      insertPaths(paths)
      return
    }
  }

  // Browser: try text/uri-list (file:// URIs)
  const uriList = e.dataTransfer?.getData('text/uri-list') ?? ''
  const paths = uriList
    .split('\n')
    .map(u => u.trim())
    .filter(u => u.startsWith('file://') && !u.startsWith('#'))
    .map(u => decodeURIComponent(new URL(u).pathname))

  insertPaths(paths)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function dispose() {
  resizeObserver?.disconnect()
  wrapEl.value?.removeEventListener('paste', onPaste, true)
  ws?.close()
  ws = null
  term?.dispose()
  term = null
}

onMounted(initTerminal)
onBeforeUnmount(dispose)

watch(() => props.sessionId, () => {
  ws?.close()
  term?.clear()
  connectWs()
})

// When becoming visible after being hidden, re-fit so xterm has the correct size.
watch(() => props.visible, (v) => {
  if (v) nextTick(syncSize)
})
</script>

<style scoped>
.terminal-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1117;
  position: relative;
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.session-label {
  font-family: monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Terminal body fills all remaining space */
.terminal-body {
  flex: 1;
  overflow: hidden;
  /* no padding — xterm handles its own inner spacing */
}

/* xterm internal viewport must fill the container */
.terminal-body :deep(.xterm) { height: 100%; }
.terminal-body :deep(.xterm-viewport) { overflow-y: auto !important; }
.terminal-body :deep(.xterm-screen) { height: 100%; }

.drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(31, 111, 235, 0.18);
  border: 2px dashed var(--blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--blue);
  pointer-events: none;
  border-radius: 4px;
}

.upload-status {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
