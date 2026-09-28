<template>
  <form class="composer" :class="{ focused, dragging }" @submit.prevent="submit" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="drop">
    <SuggestMenu
      v-if="suggest"
      :title="suggest.kind === 'file' ? 'Файлы проекта' : 'Команды'"
      :items="suggestItems"
      :active="active"
      :loading="loadingFiles"
      :empty="suggest.kind === 'file' ? 'Ничего не найдено' : 'Нет команд'"
      @hover="active = $event"
      @pick="pick"
    />

    <div v-if="attachments.length" class="attachments">
      <span v-for="(file, index) in attachments" :key="index" class="chip">
        <img v-if="file.preview" :src="file.preview" alt="" />
        <span class="chip-name">{{ file.name }}</span>
        <button type="button" class="chip-remove" title="Убрать" @click="attachments.splice(index, 1)">×</button>
      </span>
    </div>

    <textarea
      ref="input"
      v-model="text"
      rows="1"
      :placeholder="placeholder"
      @input="changed"
      @keydown="keydown"
      @click="detect"
      @keyup="caretMoved"
      @focus="focused = true"
      @blur="blur"
      @paste="paste"
    />

    <div class="toolbar">
      <div class="tools">
        <label class="btn btn-subtle btn-sm btn-icon" title="Прикрепить файл">
          <svg viewBox="0 0 16 16" fill="none"><path d="M13 7.5l-5.2 5.2a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3L6.3 11.2a1 1 0 0 1-1.5-1.5L10 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <input type="file" multiple hidden @change="filesSelected" />
        </label>
        <button type="button" class="btn btn-subtle btn-sm btn-icon" title="Упомянуть файл (@)" @click="insertAt">@</button>
      </div>
      <div class="actions">
        <slot name="status" />
        <AppButton v-if="busy && !canSend" type="button" variant="ghost" size="sm" title="Остановить агента" @click="$emit('cancel')">
          <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
          <span class="send-label">Стоп</span>
        </AppButton>
        <AppButton v-else type="submit" variant="primary" size="sm" :disabled="!canSend || disabled" :title="busy ? 'Отправится, когда агент закончит' : 'Отправить (Enter)'">
          <span class="send-label">{{ busy ? 'В очередь' : 'Отправить' }}</span>
          <svg viewBox="0 0 16 16" fill="none"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '@core/api'
import AppButton from '@shared/ui/AppButton.vue'
import SuggestMenu, { type SuggestItem } from './SuggestMenu.vue'

export type ContentBlock = Record<string, unknown>
interface FileHit { path: string; dir: boolean; uri: string }
interface Attachment { name: string; preview?: string; block: ContentBlock }

const props = withDefaults(defineProps<{
  projectId: string
  commands?: { name: string; description: string }[]
  busy?: boolean
  disabled?: boolean
  placeholder?: string
}>(), { commands: () => [], busy: false, disabled: false, placeholder: 'Напишите агенту…  @ — файл, / — команда' })
const emit = defineEmits<{ send: [content: ContentBlock[]]; cancel: []; error: [message: string] }>()

const input = ref<HTMLTextAreaElement>()
const text = ref('')
const attachments = ref<Attachment[]>([])
const focused = ref(false), dragging = ref(false)
const canSend = computed(() => !!text.value.trim() || attachments.value.length > 0)

// ── @files and /commands suggestions ──────────────────────────────────────
const suggest = ref<{ kind: 'file' | 'command'; start: number; end: number; query: string } | null>(null)
const files = ref<FileHit[]>([])
const loadingFiles = ref(false)
const active = ref(0)
const mentions = new Map<string, string>() // inserted path -> file URI
let dismissedAt = -1
let request = 0
let timer: ReturnType<typeof setTimeout> | undefined

const suggestItems = computed<SuggestItem[]>(() => {
  if (!suggest.value) return []
  if (suggest.value.kind === 'command') {
    const q = suggest.value.query.toLowerCase()
    return props.commands.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50)
      .map(c => ({ value: c.name, label: '/' + c.name, detail: c.description, command: true }))
  }
  return files.value.map(f => {
    const trimmed = f.dir ? f.path.slice(0, -1) : f.path
    const cut = trimmed.lastIndexOf('/') + 1
    return { value: f.path, prefix: trimmed.slice(0, cut), label: trimmed.slice(cut) + (f.dir ? '/' : ''), dir: f.dir }
  })
})

function detect() {
  const el = input.value
  if (!el || el.selectionStart !== el.selectionEnd) { suggest.value = null; return }
  const caret = el.selectionStart
  const before = text.value.slice(0, caret)
  const at = /(^|\s)@([^\s@]*)$/.exec(before)
  const slash = /^\/(\S*)$/.exec(before)
  const next = at ? { kind: 'file' as const, start: caret - at[2].length - 1, end: caret, query: at[2] }
    : slash && props.commands.length ? { kind: 'command' as const, start: 0, end: caret, query: slash[1] } : null
  if (!next || next.start === dismissedAt) { suggest.value = null; return }
  const changedQuery = next.kind !== suggest.value?.kind || next.query !== suggest.value?.query
  suggest.value = next
  if (changedQuery) { active.value = 0; if (next.kind === 'file') searchFiles(next.query) }
}

function searchFiles(query: string) {
  clearTimeout(timer)
  loadingFiles.value = true
  const id = ++request
  timer = setTimeout(async () => {
    try {
      const rows = await api.get<FileHit[]>(`/projects/${props.projectId}/files?q=${encodeURIComponent(query)}`)
      if (id === request) files.value = rows
    } catch { if (id === request) files.value = [] }
    finally { if (id === request) loadingFiles.value = false }
  }, query ? 70 : 0)
}

async function replaceRange(start: number, end: number, value: string) {
  text.value = text.value.slice(0, start) + value + text.value.slice(end)
  await nextTick()
  const caret = start + value.length
  input.value?.focus()
  input.value?.setSelectionRange(caret, caret)
  resize()
}

/** Enter on a folder drills into it; Tab (or a file) inserts the pick as-is and closes the list. */
async function pick(item: SuggestItem, commit = false) {
  const s = suggest.value
  if (!s) return
  if (s.kind === 'command') {
    suggest.value = null
    await replaceRange(s.start, s.end, `/${item.value} `)
    return
  }
  const hit = files.value.find(f => f.path === item.value)
  if (hit) mentions.set(hit.dir ? hit.path.slice(0, -1) : hit.path, hit.uri)
  const drill = item.dir && !commit
  await replaceRange(s.start, s.end, `@${item.value}${drill ? '' : ' '}`)
  if (drill) detect(); else suggest.value = null
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (suggest.value) {
    const count = suggestItems.value.length
    if (event.key === 'ArrowDown' && count) { event.preventDefault(); active.value = (active.value + 1) % count; return }
    if (event.key === 'ArrowUp' && count) { event.preventDefault(); active.value = (active.value - 1 + count) % count; return }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && count) { event.preventDefault(); void pick(suggestItems.value[active.value], event.key === 'Tab'); return }
    if (event.key === 'Escape') { event.preventDefault(); dismissedAt = suggest.value.start; suggest.value = null; return }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
}

function caretMoved(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) detect()
}

function changed() {
  if (dismissedAt >= 0 && !text.value.slice(dismissedAt).startsWith('@')) dismissedAt = -1
  resize()
  detect()
}

function blur() {
  focused.value = false
  suggest.value = null
}

async function insertAt() {
  const el = input.value!
  const pos = el.selectionStart ?? text.value.length
  const needsSpace = pos > 0 && !/\s/.test(text.value[pos - 1])
  dismissedAt = -1
  await replaceRange(pos, el.selectionEnd ?? pos, needsSpace ? ' @' : '@')
  detect()
}

function resize() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 240) + 'px'
}

// ── Sending ───────────────────────────────────────────────────────────────
function submit() {
  if (!canSend.value || props.disabled) return
  const value = text.value.trim()
  const links: ContentBlock[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(/(?:^|\s)@(\S+)/g)) {
    const path = match[1].replace(/\/$/, '')
    const uri = mentions.get(path)
    if (uri && !seen.has(path)) { seen.add(path); links.push({ type: 'resource_link', uri, name: path }) }
  }
  emit('send', [...(value ? [{ type: 'text', text: value }] : []), ...links, ...attachments.value.map(a => a.block)])
  text.value = ''
  attachments.value = []
  mentions.clear()
  suggest.value = null
  void nextTick(resize)
}

async function addFiles(list: File[]) {
  for (const file of list) {
    if (file.size > 10_000_000) { emit('error', `«${file.name}» больше 10 МБ — не прикреплён`); continue }
    if (file.type.startsWith('image/')) {
      const url = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file) })
      attachments.value.push({ name: file.name || 'изображение', preview: url, block: { type: 'image', mimeType: file.type, data: url.split(',')[1] } })
    } else {
      attachments.value.push({ name: file.name, block: { type: 'resource', resource: { uri: `file:///${encodeURIComponent(file.name)}`, mimeType: file.type || 'text/plain', text: await file.text() } } })
    }
  }
}
function filesSelected(event: Event) { const el = event.target as HTMLInputElement; void addFiles(Array.from(el.files ?? [])); el.value = '' }
function drop(event: DragEvent) { dragging.value = false; void addFiles(Array.from(event.dataTransfer?.files ?? [])) }
function paste(event: ClipboardEvent) { if (event.clipboardData?.files.length) { event.preventDefault(); void addFiles(Array.from(event.clipboardData.files)) } }

watch(() => props.projectId, () => { files.value = []; mentions.clear() })

defineExpose({
  focus: () => input.value?.focus(),
  setText: async (value: string) => { text.value = value; await nextTick(); resize(); input.value?.focus() },
})
</script>

<style scoped>
.composer {
  position: relative;
  container: composer / inline-size;
  display: flex;
  flex-direction: column;
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.composer.focused { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.composer.dragging { border-style: dashed; border-color: var(--blue-hover); }
textarea {
  width: 100%;
  min-height: 44px;
  max-height: 240px;
  padding: 12px 14px 4px;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
textarea::placeholder { color: var(--text-faint); }
.toolbar { display: flex; align-items: flex-end; gap: 8px; padding: 4px 8px 8px; }
.tools { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.actions { flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
.tools .btn-icon { font-size: 14px; font-weight: 600; }
/* Narrow composer: rings without numbers, icon-only buttons. */
@container composer (max-width: 460px) {
  .actions :deep(.meter-text), .send-label { display: none; }
}
.attachments { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  height: 28px;
  padding: 0 4px 0 8px;
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.chip img { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; margin-left: -4px; }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-remove { width: 20px; height: 20px; flex-shrink: 0; background: none; border: none; border-radius: 4px; color: var(--text-muted); cursor: pointer; font-size: 15px; line-height: 1; }
.chip-remove:hover { background: var(--bg-hover); color: var(--text); }
</style>
