<template>
  <section v-if="git.repository" class="commit" @keydown.enter.ctrl.exact.prevent="commitByKey" @keydown.enter.meta.exact.prevent="commitByKey">
    <textarea
      v-model="message" class="cb-message" :class="{ forbidden, warning: formatWarning }" rows="4" spellcheck="false"
      :placeholder="generating ? 'Агент пишет сообщение…' : 'Сообщение коммита: первая строка — заголовок, дальше — описание'" aria-label="Сообщение коммита" :disabled="generating"
    />
    <CoauthorsField v-if="coauthorsOpen" v-model="coauthors" :known="git.coauthors" />
    <div v-for="(violation, i) in check?.violations" :key="i" class="cb-violation" :class="violation.kind === 'forbidden' ? 'red' : 'yellow'">
      Строка {{ violation.line }}: {{ violation.kind === 'forbidden' ? 'запрещённый текст' : 'не по формату' }} — {{ violation.text }}
    </div>
    <button v-if="forbidden" type="button" class="cb-link" title="Убрать запрещённые строки из сообщения" @click="clean">Убрать запрещённое</button>
    <div v-if="error" role="alert" class="cb-error">{{ error }}</div>
    <div v-else-if="done" role="status" class="cb-done">Коммит создан</div>
    <details v-if="error && shown && git.output" class="cb-log"><summary>Вывод git и хуков</summary><pre>{{ git.output }}</pre></details>
    <div class="cb-actions">
      <button type="button" class="cb-tool" :disabled="generating || !!git.blocked || !code.changes.length" :title="git.blocked || 'Агент предложит сообщение по изменениям, отмеченным к коммиту (если ничего не отмечено — по всем)'" aria-label="Предложить сообщение" @click="generate">✨</button>
      <button type="button" class="cb-tool" :class="{ on: coauthorsOpen || coauthors.length }" :title="coauthors.length ? 'Соавторы: ' + coauthors.map(c => c.name).join(', ') : 'Добавить соавтора'" aria-label="Соавторы" @click="coauthorsOpen = !coauthorsOpen">
        👥<span v-if="coauthors.length" class="cb-badge">{{ coauthors.length }}</span>
      </button>
      <span class="cb-hint">Ctrl+Enter</span>
      <button v-if="overrideNeeded" type="button" class="btn btn-danger-ghost btn-sm" :disabled="!!git.blocked || checking" @click="commit(mode, true)">Всё равно</button>
      <SplitButton variant="blue" :items="menu" :disabled="!canCommit" :menu-disabled="!canCommit" :title="disabledReason" @click="commit(mode, false)">
        {{ committing ? 'Коммит…' : mode === 'staged' ? `Закоммитить ${stagedCount}` : 'Закоммитить всё' }}
      </SplitButton>
    </div>
    <div v-if="code.head" class="cb-last" :title="code.repository?.message ?? ''">
      <span class="cb-last-label">Последний коммит</span>
      <span class="cb-last-text">{{ code.repository?.message || '—' }}</span>
      <code>{{ code.head.slice(0, 7) }}</code>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import SplitButton from '@shared/ui/SplitButton.vue'
import type { MenuItem } from '@shared/ui/AppMenu.vue'
import { gitApi } from '../api'
import { useGitStore } from '../stores/git'
import { useCodeStore } from '../stores/code'
import type { MessageCheck, CommitInput, Coauthor } from '../git-types'
import type { GitChange } from '../types'
import CoauthorsField from './CoauthorsField.vue'

/** The commit box under the changes, as in Zed: one message field, the agent's suggestion and a commit button with its variants. */
const props = defineProps<{ taskId?: string }>()
const git = useGitStore(), code = useCodeStore()
const message = ref(''), coauthors = ref<Coauthor[]>([]), coauthorsOpen = ref(false)
const generating = ref(false), checking = ref(false), error = ref(''), check = ref<MessageCheck | null>(null), overrideNeeded = ref(false)
/** committing — this box's commit is running; shown — its hook output is still relevant. */
const committing = ref(false), shown = ref(false), done = ref(false)

const isStaged = (change: GitChange) => !['.', ' ', '?'].includes(change.indexStatus)
const stagedCount = computed(() => code.changes.filter(isStaged).length)
/** With something ticked the commit takes just that; otherwise everything, like Zed's «Commit Tracked». */
const mode = computed<'staged' | 'all'>(() => (stagedCount.value ? 'staged' : 'all'))
const menu = computed<MenuItem[]>(() => [
  { label: `Закоммитить отмеченные (${stagedCount.value})`, disabled: !stagedCount.value, action: () => void commit('staged', false) },
  { label: `Закоммитить всё (${code.changes.length})`, hint: 'Отметить все изменения, включая новые файлы, и закоммитить', action: () => void commit('all', false) },
])
const title = computed(() => message.value.split('\n')[0].trim())
const body = computed(() => message.value.split('\n').slice(1).join('\n').trim())
const input = computed<CommitInput>(() => ({ title: title.value, body: body.value, includeDescription: !!body.value, includeCoauthors: coauthors.value.length > 0, coauthors: coauthors.value }))
const forbidden = computed(() => check.value?.violations.some(v => v.kind === 'forbidden'))
const formatWarning = computed(() => check.value?.violations.some(v => v.kind === 'format'))
const disabledReason = computed(() => git.blocked || (!code.changes.length ? 'Нет изменений' : !title.value ? 'Напишите сообщение коммита' : ''))
const canCommit = computed(() => !disabledReason.value && !checking.value && !generating.value && !committing.value)
const errorOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')

let timer: ReturnType<typeof setTimeout> | undefined, version = 0
watch(input, () => {
  clearTimeout(timer); const current = ++version
  check.value = null; overrideNeeded.value = false; error.value = ''
  if (!title.value) { checking.value = false; return }
  done.value = false
  checking.value = true
  timer = setTimeout(async () => {
    try { const result = await gitApi.checkMessage(git.projectId, input.value); if (current === version) check.value = result }
    catch (cause) { if (current === version) error.value = errorOf(cause) }
    finally { if (current === version) checking.value = false }
  }, 300)
}, { deep: true })
watch(() => git.lastAction, action => { if (action && action !== 'commit') shown.value = false })
onBeforeUnmount(() => { clearTimeout(timer); version++ })

function clean() {
  if (!check.value) return
  message.value = check.value.cleaned.trim()
  if (check.value.cleanedCoauthors) coauthors.value = check.value.cleanedCoauthors
}
const pathsOf = (list: GitChange[]) => list.flatMap(c => [c.path, ...(c.originalPath ? [c.originalPath] : [])])
/** Ticks every change: «закоммитить всё» and a suggestion with nothing ticked work on the whole folder. */
async function stageAll() { if (code.changes.some(c => !isStaged(c))) await git.run('stage', { paths: pathsOf(code.changes) }) }
async function generate() {
  generating.value = true; error.value = ''
  try {
    if (!stagedCount.value) await stageAll()
    const text = await gitApi.generateMessage(git.projectId, { taskId: props.taskId, includeDescription: git.settings?.include_description ?? false })
    message.value = [text.title, text.body].filter(Boolean).join('\n\n')
  } catch (cause) { error.value = errorOf(cause) } finally { generating.value = false; void code.refresh() }
}
function commitByKey() { if (canCommit.value) void commit(mode.value, false) }
async function commit(kind: 'staged' | 'all', overrideForbidden: boolean) {
  error.value = ''; done.value = false; committing.value = true; shown.value = true
  try {
    if (kind === 'all') await stageAll()
    await git.run('commit', { ...input.value, overrideForbidden })
    message.value = ''; overrideNeeded.value = false; done.value = true
  } catch (cause) {
    overrideNeeded.value = (cause as { code?: string }).code === 'forbidden_message'
    error.value = overrideNeeded.value ? 'В сообщении есть запрещённый текст. Уберите его или закоммитьте как есть.' : errorOf(cause)
  } finally { committing.value = false; void code.refresh() }
}
</script>

<style scoped>
.commit { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 8px; max-height: 55%; overflow: auto; border-top: 1px solid var(--border); font-size: 12px; background: var(--bg); }
.cb-message { width: 100%; min-height: 64px; padding: 6px 8px; font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; color: var(--text); background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); resize: vertical; }
.cb-message:focus { outline: none; border-color: var(--blue); }
.cb-message.forbidden { border-color: var(--danger-hover); }
.cb-message.warning { border-color: var(--warning); }
.cb-violation { line-height: 1.4; overflow-wrap: anywhere; }
.red { color: var(--danger-hover); } .yellow { color: var(--warning-text); }
.cb-error { padding: 6px 8px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; }
.cb-link { align-self: flex-start; padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; text-decoration: underline; }
.cb-actions { display: flex; align-items: center; gap: 4px; }
.cb-tool { position: relative; width: 26px; height: 24px; font: inherit; font-size: 13px; color: var(--text-muted); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; filter: grayscale(0.6); }
.cb-tool:hover:not(:disabled), .cb-tool.on { background: var(--bg3); filter: none; }
.cb-tool:disabled { opacity: 0.4; cursor: default; }
.cb-badge { position: absolute; top: -2px; right: -2px; min-width: 13px; height: 13px; padding: 0 3px; font-size: 9px; font-weight: 700; line-height: 13px; color: #fff; background: var(--blue); border-radius: var(--radius-pill); }
.cb-hint { flex: 1; text-align: right; padding-right: 4px; font-size: 11px; color: var(--text-faint); }
.cb-done { color: var(--text-muted); }
.cb-log summary { cursor: pointer; font-size: 11.5px; color: var(--text-muted); }
.cb-log pre { margin-top: 4px; }
pre { margin: 0; padding: 6px 8px; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11.5px; color: var(--text-muted); background: var(--bg2); border-radius: var(--radius-sm); }
.cb-last { display: flex; align-items: baseline; gap: 6px; min-width: 0; padding-top: 6px; border-top: 1px solid var(--border); color: var(--text-muted); }
.cb-last-label { flex-shrink: 0; font-size: 11px; color: var(--text-faint); }
.cb-last-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-last code { flex-shrink: 0; font-size: 11px; color: var(--text-faint); }
</style>
