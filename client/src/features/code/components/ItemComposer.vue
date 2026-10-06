<template>
  <form class="ic" @submit.prevent="save" @keydown.esc.stop.prevent="emit('cancel')">
    <div class="ic-top">
      <div class="ic-kind" role="group" aria-label="Тип пункта">
        <button type="button" :class="{ on: kind === 'fix' }" @click="kind = 'fix'">Замечание</button>
        <button type="button" :class="{ on: kind === 'question' }" @click="kind = 'question'">Вопрос</button>
      </div>
      <span class="ic-where">{{ where }}</span>
    </div>
    <div class="ic-field">
      <SuggestMenu v-if="token" :anchor="area" @dismiss="token = null; clear()" title="Файлы и папки" :loading="loading" empty="Ничего не найдено" :items="suggestions" :active="active" @pick="insert" @hover="active = $event" />
      <textarea
        ref="area" v-model="text" class="ic-text" rows="3" :placeholder="placeholder" spellcheck="false"
        @input="onInput" @keydown="onKey" @click="updateToken" @keyup="onKeyUp"
      />
    </div>
    <div class="ic-actions">
      <span class="ic-hint">Markdown. @ — ссылка на файл или папку. Ctrl+Enter — сохранить</span>
      <AppButton type="button" size="xs" variant="ghost" @click="emit('cancel')">Отмена</AppButton>
      <AppButton type="submit" size="xs" variant="blue" :disabled="!text.trim() || busy">Сохранить</AppButton>
    </div>
    <div v-if="error" class="ic-error">{{ error }}</div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { SuggestMenu, useMentionFiles, type SuggestItem } from '@features/agent-chat'
import { useCodeStore } from '../stores/code'
import { extractRefs } from '../utils/refs'

const props = defineProps<{
  where: string
  /** Whether the item belongs to the whole review rather than a file or line. */
  general?: boolean
  initialKind?: 'fix' | 'question'
  initialText?: string
  initialRefs?: string[]
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ save: [value: { kind: 'fix' | 'question'; text: string; refs: string[] }]; cancel: [] }>()

const store = useCodeStore()
const area = ref<HTMLTextAreaElement>()
const text = ref(props.initialText ?? '')
const kind = ref<'fix' | 'question'>(props.initialKind ?? (text.value.trimStart().startsWith('?') ? 'question' : 'fix'))
const active = ref(0)
const knownRefs = new Set(props.initialRefs ?? [])
const { suggestions, loading, search, clear } = useMentionFiles(() => store.projectId)
const token = ref<{ start: number; end: number; query: string } | null>(null)
const placeholder = computed(() => (kind.value === 'question' ? 'Что непонятно? Агент только ответит, код не тронет' : 'Что исправить? (? в начале — вопрос)'))

// "?" at the start of the text makes it a question, as the toggle would.
function onInput() {
  if (text.value.trimStart().startsWith('?')) kind.value = 'question'
  updateToken()
}

/** Every directory that has a file in the project, so folders can be referenced too. */
const paths = computed(() => {
  const dirs = new Set<string>()
  for (const file of store.files) for (let i = file.indexOf('/'); i >= 0; i = file.indexOf('/', i + 1)) dirs.add(file.slice(0, i))
  return { dirs }
})
watch(suggestions, () => { active.value = 0 })

function updateToken() {
  if (!area.value || area.value.selectionStart !== area.value.selectionEnd) { token.value = null; clear(); return }
  const caret = area.value.selectionStart
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.value.slice(0, caret))
  const previous = token.value
  token.value = match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null
  if (!token.value) clear()
  else if (!previous || previous.query !== token.value.query) search(token.value.query)
}
const onKeyUp = (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateToken() }

function insert(item: SuggestItem, commit = false) {
  const t = token.value
  if (!t) return
  knownRefs.add(item.value.replace(/\/$/, ''))
  const drill = item.dir && !commit
  const value = '@' + item.value + (drill ? '' : ' ')
  text.value = text.value.slice(0, t.start) + value + text.value.slice(t.end)
  token.value = null
  const caret = t.start + value.length
  void nextTick(() => { area.value?.focus(); area.value?.setSelectionRange(caret, caret); if (drill) updateToken(); else clear() })
}

function onKey(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape' && token.value) { event.preventDefault(); event.stopPropagation(); token.value = null; clear(); return }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); return }
  if (!suggestions.value.length) return
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % suggestions.value.length }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length }
  else if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) { event.preventDefault(); insert(suggestions.value[active.value], event.key === 'Tab') }
}

function save() {
  const value = text.value.trim()
  if (!value || props.busy) return
  emit('save', { kind: kind.value, text: value, refs: extractRefs(value, new Set([...store.files, ...knownRefs]), paths.value.dirs) })
}
onMounted(() => { area.value?.focus() })
</script>

<style scoped>
.ic { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); }
.ic-top { display: flex; align-items: center; gap: 8px; }
.ic-kind { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.ic-kind button { padding: 1px 10px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.ic-kind button.on { background: var(--blue-soft); color: var(--text); }
.ic-where { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--text-muted); }
.ic-field { position: relative; }
.ic-text { width: 100%; box-sizing: border-box; resize: vertical; padding: 6px 8px; font: inherit; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.ic-actions { display: flex; align-items: center; gap: 6px; }
.ic-hint { flex: 1; font-size: 11px; color: var(--text-faint); }
.ic-error { font-size: 12px; color: var(--danger-hover); }
</style>
