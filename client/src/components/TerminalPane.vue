<template>
  <div
    class="terminal-wrap"
    ref="wrapEl"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="terminal-header">
      <span class="session-label">{{ sessionId }}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" @click="$emit('detach')">Свернуть</button>
        <button class="btn btn-danger btn-sm" @click="$emit('kill')">Завершить</button>
      </div>
    </div>

    <div class="terminal-body" ref="termEl" @click="term?.focus()" />

    <!-- Drop overlay -->
    <div v-if="dragging" class="drop-overlay">
      <span>Отпустите файл — путь вставится в терминал</span>
    </div>

    <!-- Upload progress -->
    <div v-if="uploading" class="upload-status">Загрузка изображения...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ detach: []; kill: []; input: [text: string] }>()

const wrapEl = ref<HTMLElement>()
const termEl = ref<HTMLElement>()
const dragging = ref(false)
const uploading = ref(false)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

// Send text directly into the running PTY
function sendRaw(text: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: text }))
  } else {
    emit('input', text)
  }
}

function syncSize() {
  if (!term || !fitAddon) return
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
    if (msg.type === 'data') term?.write(msg.data)
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

  // Fit BEFORE connecting so we have the real size ready
  fitAddon.fit()

  // Keyboard input goes straight to PTY — this is how @ and all native features work
  term.onData(data => sendRaw(data))

  // ResizeObserver handles panel drag resize (window.resize misses those)
  resizeObserver = new ResizeObserver(() => syncSize())
  resizeObserver.observe(termEl.value)

  connectWs()

  // Intercept paste at the wrapper level to handle images
  wrapEl.value?.addEventListener('paste', onPaste)
}

// ── Paste from Finder (Cmd+C → Cmd+V) ───────────────────────────────────────

async function onPaste(e: ClipboardEvent) {
  const cd = e.clipboardData
  if (!cd) return

  // In Electron: webUtils.getPathForFile gives real filesystem paths directly
  if (window.electronAPI && cd.files && cd.files.length > 0) {
    e.preventDefault()
    e.stopPropagation()
    const paths = Array.from(cd.files)
      .map(f => window.electronAPI!.getFilePath(f))
      .filter(Boolean)
    if (paths.length > 0) {
      sendRaw(paths.join(' ') + ' ')
      term?.focus()
    }
    return
  }

  // Browser fallback: ask server to read macOS NSPasteboard
  if (cd.files && cd.files.length > 0) {
    e.preventDefault()
    e.stopPropagation()
    uploading.value = true
    try {
      const res = await fetch('/api/clipboard/paths')
      const { paths } = await res.json() as { paths: string[] }
      if (paths.length > 0) {
        sendRaw(paths.join(' ') + ' ')
        term?.focus()
      } else {
        term?.writeln('\r\n\x1b[33m[Для ссылки на файл используй @ в терминале]\x1b[0m')
      }
    } catch {
      term?.writeln('\r\n\x1b[31m[Ошибка чтения буфера обмена]\x1b[0m')
    } finally {
      uploading.value = false
    }
    return
  }

  // Screenshot / image from Preview — upload to temp, insert path
  const items = Array.from(cd.items)
  const imageItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'))
  if (!imageItem) return

  e.preventDefault()
  e.stopPropagation()
  const file = imageItem.getAsFile()
  if (!file) return

  const ext = file.type.split('/')[1] ?? 'png'
  uploading.value = true
  try {
    const base64 = await fileToBase64(file)
    const res = await fetch('/api/upload-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, name: `screenshot.${ext}` }),
    })
    const { path } = await res.json() as { path: string }
    sendRaw(path + ' ')
    term?.focus()
  } catch {
    term?.writeln('\r\n\x1b[31m[Не удалось загрузить изображение]\x1b[0m')
  } finally {
    uploading.value = false
  }
}

// ── Drag-and-drop from Finder ────────────────────────────────────────────────

async function onDrop(e: DragEvent) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])

  // Electron: real filesystem paths via webUtils
  if (window.electronAPI && files.length > 0) {
    const paths = files.map(f => window.electronAPI!.getFilePath(f)).filter(Boolean)
    if (paths.length > 0) {
      sendRaw(paths.join(' ') + ' ')
      term?.focus()
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

  if (paths.length > 0) {
    sendRaw(paths.join(' ') + ' ')
    term?.focus()
  }
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
  wrapEl.value?.removeEventListener('paste', onPaste)
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
