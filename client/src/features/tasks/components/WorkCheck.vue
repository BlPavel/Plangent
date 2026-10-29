<template>
  <div class="work-check">
    <header class="check-bar">
      <span class="check-summary">
        {{ data?.changes.length ?? 0 }} {{ plural(data?.changes.length ?? 0) }} · просмотрено {{ viewedCount }}
        <template v-if="rounds.length"> · ревью агентом: раунд {{ rounds.length }}<span v-if="reviewerWorking"> идёт…</span><span v-else> ✓</span></template>
      </span>
      <span class="check-spacer" />
      <button :disabled="busy || reviewerWorking || closed" @click="review">🤖 {{ data?.reviewers.length ? 'Ревью ещё раз' : 'Ревью агентом' }}</button>
      <button :disabled="loading" @click="load">Обновить</button>
      <button class="primary" :disabled="closed" @click="emit('checked')">Проверено → Завершение</button>
    </header>
    <p v-if="error" role="alert" class="check-error">{{ error }}</p>
    <div class="check-grid">
      <nav class="check-files" aria-label="Файлы работы">
        <p v-if="data && !data.changes.length" class="muted">Изменений для сравнения нет.</p>
        <div v-for="change in data?.changes ?? []" :key="change.file" class="file-row" :class="{ active: opened === change.file }">
          <button type="button" class="file-name" :title="change.file" @click="openFile(change.file)">{{ change.file }}</button>
          <button type="button" class="file-mark" :class="{ on: isViewed(change) }" :title="isViewed(change) ? 'Снять отметку «просмотрено»' : 'Отметить просмотренным'" :aria-pressed="isViewed(change)" @click="toggleViewed(change)">{{ isViewed(change) ? '✓' : '○' }}</button>
        </div>
      </nav>
      <section class="check-diff">
        <p v-if="!opened" class="muted">Выберите файл слева.</p>
        <template v-else-if="file">
          <CodeView v-model:mode="mode" :file="file" :hunks="hunks" @select="selection = $event; note = ''" />
          <p v-if="selection" class="muted">{{ selection.path }}: {{ selection.startLine }}–{{ selection.endLine }}</p>
          <textarea v-model="note" placeholder="Замечание к выделенным строкам или файлу" aria-label="Замечание" />
          <button :disabled="busy || !note.trim() || closed" @click="addRemark">Добавить замечание</button>
        </template>
      </section>
      <aside class="check-side">
        <div class="side-tabs" role="tablist">
          <button role="tab" :aria-selected="side === 'remarks'" :class="{ active: side === 'remarks' }" @click="side = 'remarks'">Замечания <span v-if="openRemarks" class="count">{{ openRemarks }}</span></button>
          <button role="tab" :aria-selected="side === 'chat'" :class="{ active: side === 'chat' }" @click="side = 'chat'">Чат</button>
        </div>
        <div v-show="side === 'remarks'" class="side-body">
          <p v-if="reviewerWorking" class="muted">Агент проверяет изменения…</p>
          <p v-if="data && !rounds.length && !ownDrafts.length" class="muted">Замечаний пока нет. Добавьте своё к строке или запустите ревью агентом.</p>
          <details v-for="(round, index) in rounds" :key="round.id" :open="index === 0">
            <summary>🤖 Раунд {{ rounds.length - index }} · {{ reviewer(round.session_id)?.reason || 'Ревью' }}</summary>
            <article v-for="item in roundItems(round.id)" :key="item.id" class="remark">
              <MessageMarkdown :text="item.text" />
              <MessageMarkdown v-if="item.answer" :text="item.answer" />
              <small>{{ item.file }} {{ item.line_start || '' }} · {{ statusText(item.status) }}</small>
              <div v-if="item.status === 'draft'" class="remark-actions">
                <label><input type="checkbox" :checked="selected.includes(item.id)" @change="toggle(item.id)" /> Поправить</label>
                <button :disabled="busy" @click="reject(item)">Не надо</button>
              </div>
              <template v-if="!['draft', 'sent', 'rejected'].includes(item.status)"><textarea v-model="replies[item.id]" aria-label="Ответ на замечание" /><button :disabled="busy || !replies[item.id]?.trim()" @click="reply(item)">Отправить ответ агенту</button></template>
            </article>
          </details>
          <article v-for="item in ownDrafts" :key="item.id" class="remark own">
            <label><input v-if="item.status === 'draft'" type="checkbox" :checked="selected.includes(item.id)" @change="toggle(item.id)" /> <b>Вы</b> {{ item.file }}: {{ item.text }} · {{ statusText(item.status) }}</label>
            <MessageMarkdown v-if="item.answer" :text="item.answer" />
            <template v-if="!['draft', 'sent', 'rejected'].includes(item.status)"><textarea v-model="replies[item.id]" aria-label="Ответ на замечание" /><button :disabled="busy || !replies[item.id]?.trim()" @click="reply(item)">Отправить ответ агенту</button></template>
          </article>
          <button class="primary send" :disabled="busy || reviewerWorking || !chosen.length || closed" @click="send">Отправить агенту ({{ chosen.length }})</button>
        </div>
        <div v-show="side === 'chat'" class="side-body chat"><WorkChat :task="task" :default-agent-id="defaultAgentId" @open-check="side = 'remarks'" /></div>
      </aside>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Task } from '@core/models'
import { api } from '@core/api'
import { onServerEvent } from '@core/api/events'
import { MessageMarkdown, useChatStore, type ChatSession } from '@features/agent-chat'
import { CodeView, parseUnifiedDiff, type ViewerFile, type LineSelection } from '@shared/code-viewer'
import type { CodeReviewItem, CodeReviewRound } from '@features/code'
import WorkChat from './WorkChat.vue'
const props = defineProps<{ task: Task; defaultAgentId?: string | null }>()
const emit = defineEmits<{ checked: [] }>()
interface CheckData { review: { id: string } | null; workspace_id?: string; changes: { file: string; diff: string }[]; items: CodeReviewItem[]; rounds: CodeReviewRound[]; reviewers: ChatSession[] }
const data = ref<CheckData>(), error = ref(''), busy = ref(false), loading = ref(false), selected = ref<string[]>([])
const opened = ref(''), file = ref<ViewerFile>(), selection = ref<LineSelection>(), note = ref(''), mode = ref<'diff' | 'file'>('diff')
const chats = useChatStore()
const replies = ref<Record<string, string>>({})
const side = ref<'remarks' | 'chat'>('remarks')
const closed = computed(() => props.task.status === 'done')
const plural = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'файл' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'файла' : 'файлов'
const statusText = (status: string) => ({ draft: 'ждёт решения', sent: 'отправлено агенту', rejected: 'не надо' } as Record<string, string>)[status] ?? status

// «Просмотрено» is remembered per file together with the size of its diff: a changed file asks for a new look.
const viewedKey = computed(() => 'plangent.viewed.' + props.task.id)
const viewed = ref<Record<string, number>>({})
const loadViewed = () => { try { viewed.value = JSON.parse(localStorage.getItem(viewedKey.value) || '{}') } catch { viewed.value = {} } }
const isViewed = (c: { file: string; diff: string }) => viewed.value[c.file] === c.diff.length
function toggleViewed(c: { file: string; diff: string }) {
  const next = { ...viewed.value }
  if (isViewed(c)) delete next[c.file]; else next[c.file] = c.diff.length
  viewed.value = next
  try { localStorage.setItem(viewedKey.value, JSON.stringify(next)) } catch { /* storage unavailable */ }
}
const viewedCount = computed(() => data.value?.changes.filter(isViewed).length ?? 0)

const base = computed(() => '/projects/' + props.task.project_id + '/tasks/' + props.task.id)
const reviewBase = computed(() => '/projects/' + props.task.project_id + '/code-reviews')
const scoped = (url: string) => url + '?task=' + encodeURIComponent(props.task.id) + (data.value?.workspace_id ? '&workspace=' + encodeURIComponent(data.value.workspace_id) : '')
const reviewer = (id: string | null) => data.value?.reviewers.find(s => s.id === id)
const rounds = computed(() => [...(data.value?.rounds ?? [])].filter(r => reviewer(r.session_id)).reverse())
const reviewerWorking = computed(() => data.value?.reviewers.some(s => ['starting', 'thinking', 'waiting'].includes(s.status)) ?? false)
const taskItems = computed(() => data.value?.items.filter(i => i.origin_id === props.task.id) ?? [])
const ownDrafts = computed(() => taskItems.value.filter(i => i.author === 'developer'))
const openRemarks = computed(() => taskItems.value.filter(i => i.status === 'draft').length)
const chosen = computed(() => taskItems.value.filter(i => i.status === 'draft' && selected.value.includes(i.id)).map(i => i.id))
const roundItems = (id: string) => {
  const session = reviewer(data.value?.rounds.find(r => r.id === id)?.session_id ?? null)
  const ids = session?.metadata.task_review_items
  return taskItems.value.filter(i => Array.isArray(ids) ? ids.includes(i.id) : i.round_id === id)
}
const hunks = computed(() => parseUnifiedDiff(data.value?.changes.find(c => c.file === opened.value)?.diff ?? ''))
const toggle = (id: string) => { selected.value = selected.value.includes(id) ? selected.value.filter(i => i !== id) : [...selected.value, id] }
let version = 0
async function load() {
  const mine = ++version
  loading.value = true
  try {
    const result = await api.get<CheckData>(base.value + '/check')
    if (mine === version) { data.value = result; error.value = '' }
  } catch (cause) { if (mine === version) error.value = String(cause) }
  finally { if (mine === version) loading.value = false }
}
async function run(action: () => Promise<unknown>) {
  busy.value = true; error.value = ''
  try { await action(); await load() } catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
async function review() {
  await run(async () => {
    const session = await api.post<ChatSession>(base.value + '/review', {})
    chats.put(session)
  })
}
async function send() {
  await run(async () => {
    const chat = await api.post<ChatSession>(base.value + '/check/send', { item_ids: chosen.value, agent_id: props.defaultAgentId })
    chats.put(chat); selected.value = []; side.value = 'chat'
  })
}
async function reply(item: CodeReviewItem) {
  await run(async () => {
    await api.post(scoped(reviewBase.value + '/' + item.review_id + '/items/' + item.id + '/messages'), { kind: 'text', text: replies.value[item.id] })
    const chat = await api.post<ChatSession>(base.value + '/check/send', { item_ids: [item.id], agent_id: props.defaultAgentId })
    chats.put(chat); replies.value[item.id] = ''
  })
}
async function reject(item: CodeReviewItem) {
  await run(() => api.post(scoped(reviewBase.value + '/' + item.review_id + '/items/' + item.id + '/close'), { resolution: 'reject' }))
}
async function openFile(path: string) {
  opened.value = path; selection.value = undefined; file.value = undefined
  const target = props.task.id
  try {
    const result = await api.get<ViewerFile>(base.value + '/check/file?file=' + encodeURIComponent(path))
    if (opened.value === path && props.task.id === target) file.value = result
  } catch (cause) { error.value = String(cause) }
}
async function addRemark() {
  await run(async () => {
    const value = selection.value
    const result = await api.post<{ item: CodeReviewItem }>(scoped(reviewBase.value + '/items'), {
      origin: 'task', origin_id: props.task.id, scope: value ? 'line' : 'file', file: opened.value,
      side: value?.side ?? 'new', line_start: value?.startLine, line_end: value?.endLine, kind: 'fix', text: note.value,
    })
    selected.value.push(result.item.id); note.value = ''; selection.value = undefined
  })
}
let timer: ReturnType<typeof setTimeout> | undefined
const stop = onServerEvent(event => {
  if (event.type === 'code_review_updated' || (event.type === 'agent_session' && (event as { session?: ChatSession }).session?.task_id === props.task.id)) {
    clearTimeout(timer); timer = setTimeout(() => void load(), 150)
  }
})
onBeforeUnmount(() => { stop(); clearTimeout(timer); version++ })
watch(() => props.task.id, () => { loadViewed(); data.value = undefined; selected.value = []; opened.value = ''; file.value = undefined; void load() }, { immediate: true })
</script>
<style scoped>
.work-check { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.check-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.check-summary { font-size: 12.5px; color: var(--text-muted); }
.check-spacer { flex: 1; }
.check-error { padding: 6px 16px; color: var(--danger-hover); }
.check-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr) minmax(320px, 2fr); }
.check-files, .check-diff, .check-side { min-height: 0; overflow: auto; }
.check-files { padding: 8px; border-right: 1px solid var(--border); }
.check-diff { padding: 12px; }
.check-side { display: flex; flex-direction: column; border-left: 1px solid var(--border); overflow: hidden; }
.file-row { display: flex; align-items: center; gap: 4px; border-radius: var(--radius-sm); }
.file-row.active { background: var(--bg3); }
.file-name { flex: 1; min-width: 0; padding: 5px 6px; background: none; border: none; color: inherit; font: inherit; font-size: 12.5px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; direction: rtl; }
.file-mark { padding: 2px 6px; background: none; border: none; color: var(--text-muted); cursor: pointer; }
.file-mark.on { color: var(--accent-hover); }
.side-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.side-tabs button { padding: 8px 14px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; font: inherit; }
.side-tabs button.active { color: var(--text); border-bottom-color: var(--blue); }
.count { margin-left: 4px; padding: 0 6px; border-radius: var(--radius-pill); background: var(--warning); color: #0d1117; font-size: 11px; font-weight: 700; }
.side-body { flex: 1; min-height: 0; overflow: auto; padding: 8px; }
.side-body.chat { overflow: hidden; }
.remark, details { padding: 10px; margin: 8px 0; border: 1px solid var(--border); border-radius: 6px; }
.remark-actions { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.muted { font-size: 12.5px; color: var(--text-muted); }
textarea { display: block; width: 100%; min-height: 64px; margin: 6px 0; }
button { padding: 6px 10px; cursor: pointer; }
.send { width: 100%; margin-top: 8px; }
:deep(.code-view) { height: 400px; }
</style>
