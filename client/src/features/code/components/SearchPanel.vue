<template>
  <div class="sp">
    <div class="sp-form">
      <div class="sp-row">
        <input ref="input" v-model="query" class="sp-input" placeholder="Поиск по проекту" spellcheck="false" @keydown.enter.prevent="runNow" @keydown.esc="query = ''" />
        <button type="button" class="sp-opt" :class="{ on: caseSensitive }" title="Учитывать регистр" @click="caseSensitive = !caseSensitive">Aa</button>
        <button type="button" class="sp-opt" :class="{ on: wholeWord }" title="Слово целиком" @click="wholeWord = !wholeWord">ab</button>
        <button type="button" class="sp-opt" :class="{ on: regex }" title="Регулярное выражение" @click="regex = !regex">.*</button>
      </div>
      <input v-model="mask" class="sp-input" placeholder="Маска файлов: *.ts, server/**" spellcheck="false" />
    </div>

    <div class="sp-status">
      <template v-if="error">{{ error }}</template>
      <template v-else-if="!query.trim()">Введите запрос</template>
      <template v-else-if="store.searching">Поиск… {{ store.matches.length }}</template>
      <template v-else-if="summary">
        {{ summary.matches ? `${summary.matches} ${plural(summary.matches, 'совпадение', 'совпадения', 'совпадений')} в ${summary.files} ${plural(summary.files, 'файле', 'файлах', 'файлах')}` : 'Ничего не найдено' }}
        <span v-if="summary.truncated" class="sp-warn"> · показаны первые {{ summary.matches }}, уточните запрос</span>
      </template>
    </div>

    <div ref="scroller" class="sp-list" @scroll.passive="onScroll">
      <div class="sp-body" :style="{ height: rows.length * ROW + 'px' }">
        <div class="sp-window" :style="{ transform: `translateY(${first * ROW}px)` }">
          <template v-for="index in visible" :key="rows[index].key">
            <button v-if="rows[index].kind === 'file'" type="button" class="sp-file" :title="rows[index].path" @click="toggle(rows[index].path)">
              <span class="sp-chevron" :class="{ open: !collapsed.has(rows[index].path) }">›</span>
              <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
              <span class="sp-icon" v-html="iconSvg(fileIconName(rows[index].path.split('/').pop() ?? ''))" />
              <span class="sp-file-name">{{ rows[index].path.split('/').pop() }}</span>
              <span class="sp-file-dir">{{ dirOf(rows[index].path) }}</span>
              <span class="sp-count">{{ rows[index].count }}</span>
            </button>
            <button v-else type="button" class="sp-match" @click="emit('open', rows[index].path, rows[index].line)">
              <span class="sp-line">{{ rows[index].line }}</span>
              <!-- eslint-disable-next-line vue/no-v-html -- escaped text with <mark> only -->
              <span class="sp-text" v-html="rows[index].html" />
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { fileIconName, findInLine, findPattern, iconSvg, markHtml } from '@shared/code-viewer'
import { useCodeStore } from '../stores/code'

const ROW = 22
const OVERSCAN = 10
const MAX_TEXT = 240

const emit = defineEmits<{ open: [path: string, line: number] }>()
const store = useCodeStore()
const input = ref<HTMLInputElement>()
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
  | { kind: 'file'; key: string; path: string; count: number }
  | { kind: 'match'; key: string; path: string; line: number; html: string }

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

const summary = computed(() => store.searchSummary)
const error = computed(() => store.searchError ?? (query.value.trim() ? findPattern({ query: query.value, regex: regex.value }).error : undefined))

/** One file row followed by its matching lines, in the order the server streamed them. */
const rows = computed<Row[]>(() => {
  const pattern = findPattern({ query: query.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regex: regex.value }).pattern
  const groups = new Map<string, typeof store.matches>()
  for (const match of store.matches) {
    const group = groups.get(match.path)
    if (group) group.push(match)
    else groups.set(match.path, [match])
  }
  const result: Row[] = []
  for (const [path, matches] of groups) {
    result.push({ kind: 'file', key: 'f:' + path, path, count: matches.length })
    if (collapsed.has(path)) continue
    for (const match of matches) {
      const text = match.text.trimStart().slice(0, MAX_TEXT)
      const ranges = pattern ? findInLine(text, pattern) : []
      result.push({ kind: 'match', key: `m:${path}:${match.line}:${result.length}`, path, line: match.line, html: markHtml(escapeHtml(text), ranges) })
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
  if (!query.value.trim() || findPattern({ query: query.value, regex: regex.value }).error) { store.clearSearch(); return }
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
.sp-form { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-bottom: 1px solid var(--border); }
.sp-row { display: flex; align-items: center; gap: 2px; }
.sp-input { flex: 1; min-width: 0; padding: 3px 8px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.sp-opt { min-width: 24px; padding: 1px 4px; font-size: 12px; color: var(--text-muted); background: none; border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
.sp-opt:hover { color: var(--text); border-color: var(--border-strong); }
.sp-opt.on { color: var(--text); background: var(--blue-soft); border-color: var(--blue); }
.sp-status { padding: 6px 10px; font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
.sp-warn { color: var(--warning-text); }
.sp-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.sp-body { position: relative; }
.sp-window { position: absolute; top: 0; left: 0; right: 0; }
.sp-file, .sp-match { display: flex; align-items: center; gap: 6px; width: 100%; height: 22px; padding: 0 8px; font: inherit; font-size: 12px; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; overflow: hidden; }
.sp-file:hover, .sp-match:hover { background: var(--bg3); }
.sp-file { font-weight: 600; }
.sp-chevron { width: 10px; flex-shrink: 0; color: var(--text-muted); transition: transform 0.1s; }
.sp-chevron.open { transform: rotate(90deg); }
.sp-icon { display: inline-flex; flex-shrink: 0; }
.sp-icon :deep(svg) { width: 14px; height: 14px; }
.sp-file-name { flex-shrink: 0; }
.sp-file-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: var(--text-faint); }
.sp-count { flex-shrink: 0; min-width: 18px; padding: 0 5px; font-size: 10px; text-align: center; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.sp-match { padding-left: 24px; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; }
.sp-line { flex-shrink: 0; min-width: 4ch; text-align: right; color: var(--text-faint); }
.sp-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.sp-text :deep(mark) { color: inherit; background: rgba(255, 196, 0, 0.35); border-radius: 2px; }
</style>
