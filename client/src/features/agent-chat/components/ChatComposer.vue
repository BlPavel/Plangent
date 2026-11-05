<template>
  <form class="composer" :class="{ focused, dragging }" @submit.prevent="submit" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="drop">
    <SuggestMenu
      v-if="suggest"
      :anchor="input"
      @dismiss="suggest = null; clearFiles()"
      :title="suggest.kind === 'file' ? 'Файлы проекта' : 'Команды'"
      :items="suggestItems"
      :active="active"
      :loading="loadingFiles"
      :empty="suggest.kind === 'file' ? 'Ничего не найдено' : 'Нет команд'"
      @hover="active = $event"
      @pick="pick"
    />

    <div v-if="attachments.length" class="attachments">
      <AppChip v-for="(file, index) in attachments" :key="index" removable remove-label="Убрать" @remove="attachments.splice(index, 1)">
        <img v-if="file.preview" :src="file.preview" alt="" />
        <span class="chip-name">{{ file.name }}</span>
      </AppChip>
    </div>

    <AppTextarea block
      ref="inputComponent"
      composer
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
        <AppButton variant="subtle" size="sm" icon title="Прикрепить файл" aria-label="Прикрепить файл" @click="fileInput?.element?.click()">
          <UIIconAttach />
        </AppButton>
        <AppInput ref="fileInput" type="file" multiple hidden @change="filesSelected" />
        <AppButton variant="subtle" size="sm" icon type="button"  title="Упомянуть файл (@)" @click="insertAt">@</AppButton>
        <slot name="tools" />
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
import { IconAttach as UIIconAttach } from '@shared/ui/icons'
import AppChip from '@shared/ui/AppChip.vue'
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useMentionFiles } from '../composables/useMentionFiles'
import { useDraft } from '@core/composables/useDraft'
import { emptyDraft } from '../stores/drafts'
import { commandSuggestions, type ChatCommand } from '../utils/commands'
import AppButton from '@shared/ui/AppButton.vue'
import SuggestMenu, { type SuggestItem } from './SuggestMenu.vue'

export type ContentBlock = NonNullable<import('@contracts').AgentSessionsPOSTIdActionBody['content']>[number]

const props = withDefaults(defineProps<{
  projectId: string
  draftKey: string
  commands?: ChatCommand[]
  busy?: boolean
  disabled?: boolean
  initialText?: string
  placeholder?: string
}>(), { initialText: undefined, commands: () => [], busy: false, disabled: false, placeholder: 'Напишите агенту…  @ — файл, / — команда' })
const emit = defineEmits<{ send: [content: ContentBlock[]]; cancel: []; error: [message: string] }>()

const inputComponent = ref<InstanceType<typeof AppTextarea>>()
const input = computed(() => inputComponent.value?.element)
const fileInput = ref<InstanceType<typeof AppInput>>()
const draft = useDraft(() => props.draftKey, () => emptyDraft(props.initialText))
const text = computed({ get: () => draft.value.text, set: value => { draft.value.touched = true; draft.value.text = value } })
watch(() => props.initialText, value => { if (value !== undefined && !draft.value.touched && !draft.value.attachments.length) draft.value.text = value })
const attachments = computed({ get: () => draft.value.attachments, set: value => { draft.value.attachments = value } })
const focused = ref(false), dragging = ref(false)
const canSend = computed(() => !!text.value.trim() || attachments.value.length > 0)

// ── @files and /commands suggestions ──────────────────────────────────────
const suggest = ref<{ kind: 'file' | 'command'; start: number; end: number; query: string } | null>(null)
const { files, suggestions: fileSuggestions, loading: loadingFiles, search: searchFiles, clear: clearFiles } = useMentionFiles(() => props.projectId)
const active = ref(0)
const mentions = computed(() => draft.value.mentions) // inserted path -> file URI
let dismissedAt = -1

const suggestItems = computed<SuggestItem[]>(() => {
  if (!suggest.value) return []
  if (suggest.value.kind === 'command') {
    return commandSuggestions(props.commands, suggest.value.query)
  }
  return fileSuggestions.value
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
  if (hit) mentions.value.set(hit.dir ? hit.path.slice(0, -1) : hit.path, hit.uri)
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

onMounted(resize)
watch(text, resize, { flush: 'post' })

// ── Sending ───────────────────────────────────────────────────────────────
function submit() {
  if (!canSend.value || props.disabled) return
  const value = text.value.trim()
  const links: ContentBlock[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(/(?:^|\s)@(\S+)/g)) {
    const path = match[1].replace(/\/$/, '')
    const uri = mentions.value.get(path)
    if (uri && !seen.has(path)) { seen.add(path); links.push({ type: 'resource_link', uri, name: path }) }
  }
  emit('send', [...(value ? [{ type: 'text' as const, text: value }] : []), ...links, ...attachments.value.map(a => a.block)])
  text.value = ''
  attachments.value = []
  mentions.value.clear()
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

watch(() => props.projectId, () => { clearFiles() })
watch(() => props.draftKey, () => { suggest.value = null; dismissedAt = -1; clearFiles() })

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
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.composer.focused { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
.composer.dragging { border-style: dashed; border-color: var(--blue-hover); }
.toolbar { display: flex; align-items: flex-end; gap: 8px; padding: 4px 8px 8px; }
.tools { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.actions { flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
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
  font-size: var(--fs-sm);
}
.chip img { width: 20px; height: 20px; object-fit: cover; border-radius: var(--radius-4); margin-left: -4px; }
.chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-remove { width: 20px; height: 20px; flex-shrink: 0; background: none; border: none; border-radius: var(--radius-4); color: var(--text-muted); cursor: pointer; font-size: var(--fs-lg); line-height: 1; }
.chip-remove:hover { background: var(--bg-hover); color: var(--text); }
</style>
