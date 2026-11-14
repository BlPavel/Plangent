<template>
  <div class="sp">
    <div class="sp-form">
      <div class="sp-row">
        <AppInput ref="input" v-model="query" class="sp-query" size="sm" placeholder="Поиск по проекту" spellcheck="false" @keydown.enter.prevent="runNow" @keydown.esc="query = ''" />
        <AppButton variant="subtle" size="xs" :pressed="caseSensitive" title="Учитывать регистр" @click="caseSensitive = !caseSensitive">Aa</AppButton>
        <AppButton variant="subtle" size="xs" :pressed="wholeWord" title="Слово целиком" @click="wholeWord = !wholeWord">ab</AppButton>
        <AppButton variant="subtle" size="xs" :pressed="regex" title="Регулярное выражение" @click="regex = !regex">.*</AppButton>
      </div>
      <AppInput v-model="mask" size="sm" block placeholder="Маска файлов: *.ts, server/**" spellcheck="false" />
    </div>

    <div class="sp-status">
      <template v-if="error">{{ error }}</template>
      <template v-else-if="!query.trim()">Введите запрос: ищется и в именах файлов, и в их тексте</template>
      <template v-else-if="store.searching">Поиск… {{ store.matches.length }}</template>
      <template v-else-if="summary">
        <template v-if="!summary.matches && !pathHits.length">Ничего не найдено</template>
        <template v-else>
          <template v-if="pathHits.length">{{ pathHits.length }}{{ pathHits.length === MAX_PATHS ? '+' : '' }} по имени</template><template v-if="pathHits.length && summary.matches"> · </template>
          <template v-if="summary.matches">{{ summary.matches }} {{ plural(summary.matches, 'совпадение', 'совпадения', 'совпадений') }} в {{ summary.files }} {{ plural(summary.files, 'файле', 'файлах', 'файлах') }}</template>
        </template>
        <span v-if="summary.truncated" class="sp-warn"> · показаны первые {{ summary.matches }}, уточните запрос</span>
      </template>
    </div>

    <div ref="scroller" class="sp-list" @scroll.passive="onScroll">
      <div class="sp-body" :style="{ height: rows.length * ROW + 'px' }">
        <div class="sp-window" :style="{ transform: `translateY(${first * ROW}px)` }">
          <template v-for="index in visible" :key="rows[index].key">
            <div v-if="rows[index].kind === 'heading'" class="sp-heading">{{ rows[index].label }}</div>
            <AppButton v-else-if="rows[index].kind === 'path'" draggable="true" @dragstart="dragMention($event, rows[index].path)" variant="subtle" size="xs" block :title="rows[index].path" @click="emit('open', rows[index].path)">
              <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
              <span class="sp-icon" v-html="iconSvg(fileIconName(rows[index].path.split('/').pop() ?? ''))" />
              <!-- eslint-disable-next-line vue/no-v-html -- escaped text with <mark> only -->
              <span class="sp-file-name" v-html="marked(rows[index].name)" />
              <span class="sp-file-dir">{{ dirOf(rows[index].path) }}</span>
            </AppButton>
            <AppButton v-else-if="rows[index].kind === 'file'" draggable="true" @dragstart="dragMention($event, rows[index].path)" variant="subtle" size="xs" block :title="rows[index].path" @click="toggle(rows[index].path)">
              <span class="sp-chevron" :class="{ open: !collapsed.has(rows[index].path) }">›</span>
              <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
              <span class="sp-icon" v-html="iconSvg(fileIconName(rows[index].path.split('/').pop() ?? ''))" />
              <span class="sp-file-name">{{ rows[index].path.split('/').pop() }}</span>
              <span class="sp-file-dir">{{ dirOf(rows[index].path) }}</span>
              <span class="sp-count">{{ rows[index].count }}</span>
            </AppButton>
            <AppButton v-else draggable="true" @dragstart="dragMention($event, rows[index].path, false, rows[index].line)" variant="subtle" size="xs" block @click="emit('open', rows[index].path, rows[index].line)">
              <span class="sp-line">{{ rows[index].line }}</span>
              <!-- eslint-disable-next-line vue/no-v-html -- escaped text with <mark> only -->
              <span class="sp-text" v-html="marked(rows[index].text)" />
            </AppButton>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMentionDrag } from '../composables/useMentionDrag'
import AppInput from '@shared/ui/AppInput.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { fileIconName, findInLine, findPattern, iconSvg, markHtml } from '@shared/code-viewer'
import { useCodeContext } from '../stores/context'

const dragMention = useMentionDrag()
const ROW = 22
const OVERSCAN = 10
const MAX_TEXT = 240

const MAX_PATHS = 50
const emit = defineEmits<{ open: [path: string, line?: number] }>()
const store = useCodeContext()
const input = ref<InstanceType<typeof AppInput>>()
const scroller = ref<HTMLElement>()
const query = ref('')
const mask = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const regex = ref(false)
const collapsed = reactive(new Set<string>())
const scrollTop = ref(0)
const height = ref(400)

type Row =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'path'; key: string; path: string; name: string }
  | { kind: 'file'; key: string; path: string; count: number }
  | { kind: 'match'; key: string; path: string; line: number; text: string }

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

const summary = computed(() => store.searchSummary)
const error = computed(() => store.searchError ?? (query.value.trim() ? findPattern({ query: query.value, regex: regex.value }).error : undefined))

/** The query the results belong to: set by the debounced run, not by every keystroke. */
const applied = ref<{ query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean } | null>(null)
const pattern = computed(() => (applied.value ? findPattern(applied.value).pattern : null))
/** Escaped text with the matches marked; called for the rows on screen only. */
const marked = (text: string) => {
  const escaped = escapeHtml(text)
  return pattern.value ? markHtml(escaped, findInLine(text, pattern.value)) : escaped
}

/** Files whose path matches the query (the text search below only looks inside files); name hits first. */
const pathHits = computed(() => {
  const current = applied.value?.query.trim() ? findPattern({ ...applied.value, query: applied.value.query.trim() }).pattern : null
  if (!current) return []
  const hits: { path: string; byName: number }[] = []
  for (const path of store.files) {
    if (!findInLine(path, current).length) continue
    hits.push({ path, byName: findInLine(path.slice(path.lastIndexOf('/') + 1), current).length ? 0 : 1 })
  }
  return hits.sort((a, b) => a.byName - b.byName || a.path.length - b.path.length || a.path.localeCompare(b.path)).slice(0, MAX_PATHS).map(hit => hit.path)
})

/** File-name hits, then one file row followed by its matching lines, in the order the server streamed them. */
const rows = computed<Row[]>(() => {
  const result: Row[] = []
  if (pathHits.value.length) {
    result.push({ kind: 'heading', key: 'h:paths', label: 'Файлы по имени' })
    for (const path of pathHits.value) result.push({ kind: 'path', key: 'p:' + path, path, name: path.slice(path.lastIndexOf('/') + 1) })
    if (store.matches.length) result.push({ kind: 'heading', key: 'h:text', label: 'В тексте' })
  }
  const groups = new Map<string, typeof store.matches>()
  for (const match of store.matches) {
    const group = groups.get(match.path)
    if (group) group.push(match)
    else groups.set(match.path, [match])
  }
  for (const [path, matches] of groups) {
    result.push({ kind: 'file', key: 'f:' + path, path, count: matches.length })
    if (collapsed.has(path)) continue
    for (const match of matches) {
      result.push({ kind: 'match', key: `m:${path}:${match.line}:${result.length}`, path, line: match.line, text: match.text.trimStart().slice(0, MAX_TEXT) })
    }
  }
  return result
})

const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN))
const last = computed(() => Math.min(rows.value.length - 1, Math.ceil((scrollTop.value + height.value) / ROW) + OVERSCAN))
const visible = computed(() => {
  const result: number[] = []
  for (let i = first.value; i <= last.value; i++) result.push(i)
  return result
})
function onScroll() { scrollTop.value = scroller.value?.scrollTop ?? 0 }
function toggle(path: string) { if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path) }

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(() => { height.value = scroller.value?.clientHeight ?? height.value })
  if (scroller.value) observer.observe(scroller.value)
})

// Debounced: one request after the pause; the store aborts the previous stream.
let timer: ReturnType<typeof setTimeout> | undefined
function run() {
  clearTimeout(timer)
  collapsed.clear()
  if (scroller.value) scroller.value.scrollTop = 0
  scrollTop.value = 0
  if (!query.value.trim() || findPattern({ query: query.value, regex: regex.value }).error) { applied.value = null; store.clearSearch(); return }
  applied.value = { query: query.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regex: regex.value }
  void store.search({ query: query.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regex: regex.value, mask: mask.value.trim() || undefined })
}
function runNow() { run() }
watch([query, mask, caseSensitive, wholeWord, regex], () => { clearTimeout(timer); timer = setTimeout(run, 300) })
onBeforeUnmount(() => { clearTimeout(timer); observer?.disconnect(); store.cancelSearch() })

function focus(text?: string) {
  if (text && text.trim() && text !== query.value) query.value = text
  input.value?.focus(); input.value?.select()
}
defineExpose({ focus })
</script>

<style scoped>
.sp { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.sp-form { display: flex; flex-direction: column; flex-shrink: 0; gap: 4px; padding: 8px; border-bottom: 1px solid var(--border); }
.sp-row { display: flex; align-items: center; gap: 2px; }
.sp-query { flex: 1; min-width: 0; }
.sp-opt { min-width: 24px; padding: 1px 4px; font-size: var(--fs-sm); color: var(--text-muted); background: none; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
.sp-opt:hover { color: var(--text); border-color: var(--border-strong); }
.sp-opt.on { color: var(--text); background: var(--blue-soft); border-color: var(--blue); }
.sp-status { padding: 6px 10px; font-size: var(--fs-sm); color: var(--text-muted); flex-shrink: 0; }
.sp-warn { color: var(--warning-text); }
.sp-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.sp-body { position: relative; }
.sp-window { position: absolute; top: 0; left: 0; right: 0; }
.sp-file, .sp-match { display: flex; align-items: center; gap: 6px; width: 100%; height: 22px; padding: 0 8px; font: inherit; font-size: var(--fs-sm); text-align: left; color: var(--text); background: none; border: none; cursor: pointer; overflow: hidden; }
.sp-file:hover, .sp-match:hover { background: var(--bg3); }
.sp-file { font-weight: 600; }
.sp-path { font-weight: 400; padding-left: 12px; }
.sp-file-name :deep(mark) { color: inherit; background: var(--highlight); border-radius: var(--radius-xs); }
.sp-heading { display: flex; align-items: center; height: 22px; padding: 0 10px; font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.sp-chevron { width: 10px; flex-shrink: 0; color: var(--text-muted); transition: transform var(--motion-instant); }
.sp-chevron.open { transform: rotate(90deg); }
.sp-icon { display: inline-flex; flex-shrink: 0; }
.sp-icon :deep(svg) { width: 14px; height: 14px; }
.sp-file-name { flex-shrink: 0; }
.sp-file-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: var(--text-faint); }
.sp-count { flex-shrink: 0; min-width: 18px; padding: 0 5px; font-size: var(--fs-xs); text-align: center; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.sp-match { padding-left: 24px; font-family: var(--font-mono); }
.sp-line { flex-shrink: 0; min-width: 4ch; text-align: right; color: var(--text-faint); }
.sp-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.sp-text :deep(mark) { color: inherit; background: var(--highlight); border-radius: var(--radius-xs); }
</style>
