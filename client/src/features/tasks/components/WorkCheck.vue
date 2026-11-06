<template>
  <div class="work-check">
    <header class="check-bar">
      <span class="check-summary">
        {{ data?.changes.length ?? 0 }} {{ plural(data?.changes.length ?? 0) }}
        <template v-if="rounds.length"> · ревью агентом: раунд {{ rounds.length }}<span v-if="reviewerWorking"> идёт…</span><span v-else> ✓</span></template>
      </span>
      <span class="check-spacer" />
      <AppButton size="sm" :disabled="busy || reviewerWorking || closed" @click="review">🤖 {{ data?.reviewers.length ? 'Ревью ещё раз' : 'Ревью агентом' }}</AppButton>
      <AppButton size="sm" :disabled="loading" @click="load">Обновить</AppButton>
      <AppButton variant="primary" size="sm" :disabled="closed" @click="emit('checked')">Проверено → Завершение</AppButton>
    </header>
    <p v-if="error" role="alert" class="check-error">{{ error }}</p>
    <div class="check-grid">
      <nav class="check-files" aria-label="Файлы работы">
        <p v-if="data && !data.changes.length" class="muted">Изменений для сравнения нет.</p>
        <div v-for="change in data?.changes ?? []" :key="change.file" class="file-row" :class="{ active: opened === change.file }">
          <AppButton variant="link" size="sm" :title="change.file" @click="openFile(change.file)">{{ change.file }}</AppButton>
        </div>
      </nav>
      <section class="check-diff">
        <p v-if="!opened" class="muted">Выберите файл слева.</p>
        <template v-else-if="file">
          <CodeView v-model:mode="mode" :file="file" :hunks="hunks" @select="selection = $event; note = ''" />
          <p v-if="selection" class="muted">{{ selection.path }}: {{ selection.startLine }}–{{ selection.endLine }}</p>
          <AppTextarea block v-model="note" placeholder="Замечание к выделенным строкам или файлу" aria-label="Замечание" />
          <AppButton size="sm" :disabled="busy || !note.trim() || closed" @click="addRemark">Добавить замечание</AppButton>
        </template>
      </section>
      <aside class="check-side">
        <AppTabs :model-value="side" :items="[{ value: 'remarks', label: 'Замечания', count: openRemarks || undefined }, { value: 'chat', label: 'Чат' }]" @update:model-value="side = $event as 'remarks' | 'chat'" />
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
                <AppCheckbox :model-value="selected.includes(item.id)" @update:model-value="toggle(item.id)">Поправить</AppCheckbox>
                <AppButton size="sm" :disabled="busy" @click="reject(item)">Не надо</AppButton>
              </div>
              <template v-if="!['draft', 'sent', 'rejected'].includes(item.status)"><AppTextarea block v-model="replies[item.id]" aria-label="Ответ на замечание" /><AppButton size="sm" :disabled="busy || !replies[item.id]?.trim()" @click="reply(item)">Отправить ответ агенту</AppButton></template>
            </article>
          </details>
          <article v-for="item in ownDrafts" :key="item.id" class="remark own">
            <AppCheckbox v-if="item.status === 'draft'" :model-value="selected.includes(item.id)" @update:model-value="toggle(item.id)"><b>Вы</b> {{ item.file }}: {{ item.text }} · {{ statusText(item.status) }}</AppCheckbox>
            <span v-else><b>Вы</b> {{ item.file }}: {{ item.text }} · {{ statusText(item.status) }}</span>
            <MessageMarkdown v-if="item.answer" :text="item.answer" />
            <template v-if="!['draft', 'sent', 'rejected'].includes(item.status)"><AppTextarea block v-model="replies[item.id]" aria-label="Ответ на замечание" /><AppButton size="sm" :disabled="busy || !replies[item.id]?.trim()" @click="reply(item)">Отправить ответ агенту</AppButton></template>
          </article>
          <AppButton variant="primary" size="sm" :disabled="busy || reviewerWorking || !chosen.length || closed" @click="send">Отправить агенту ({{ chosen.length }})</AppButton>
        </div>
        <div v-show="side === 'chat'" class="side-body chat"><WorkChat :task="task" :default-agent-id="defaultAgentId" @open-check="side = 'remarks'" /></div>
      </aside>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useCodeScreen } from '@core/composables/useCodeScreen'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { AppButton, AppCheckbox, AppTabs } from '@shared/ui'
import { useDraft } from '@core/composables/useDraft'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Task } from '@contracts'
import { tasksEndpoints } from '../api'
import { codeEndpoints } from '@features/code'
import { onServerEvent } from '@core/api/events'
import { MessageMarkdown, useChatStore, type ChatSession } from '@features/agent-chat'
import { CodeView, parseUnifiedDiff, type ViewerFile, type LineSelection } from '@shared/code-viewer'
import type { CodeReviewItem} from '@features/code'
import WorkChat from './WorkChat.vue'
useCodeScreen()

const props = defineProps<{ task: Task; defaultAgentId?: string | null }>()
const emit = defineEmits<{ checked: [] }>()
type CheckData = import('@contracts').WorkCheck
const data = ref<CheckData>(), error = ref(''), busy = ref(false), loading = ref(false), selected = ref<string[]>([])
const opened = ref(''), file = ref<ViewerFile>(), selection = ref<LineSelection>(), note = useDraft(() => `task:${props.task.id}:check:note`, () => ''), mode = ref<'diff' | 'file'>('diff')
const chats = useChatStore()
const replies = ref<Record<string, string>>({})
const side = ref<'remarks' | 'chat'>('remarks')
const closed = computed(() => props.task.status === 'done')
const plural = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'файл' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'файла' : 'файлов'
const statusText = (status: string) => ({ draft: 'ждёт решения', sent: 'отправлено агенту', rejected: 'не надо' } as Record<string, string>)[status] ?? status

const params = () => ({ projectId: props.task.project_id, taskId: props.task.id })
const query = () => ({ task: props.task.id, workspace: data.value?.workspace_id })
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
    const result = await tasksEndpoints.checkTask({ params: params() })
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
    const session = await tasksEndpoints.reviewTask({ params: params(), body: {} })
    chats.put(session)
  })
}
async function send() {
  await run(async () => {
    const chat = await tasksEndpoints.sendCheck({ params: params(), body: { item_ids: chosen.value, agent_id: props.defaultAgentId ?? undefined } })
    chats.put(chat); selected.value = []; side.value = 'chat'
  })
}
async function reply(item: CodeReviewItem) {
  await run(async () => {
    await codeEndpoints.taskMessage({ params: { projectId: props.task.project_id, reviewId: item.review_id, itemId: item.id }, query: query(), body: { kind: 'text', text: replies.value[item.id] } })
    const chat = await tasksEndpoints.sendCheck({ params: params(), body: { item_ids: [item.id], agent_id: props.defaultAgentId ?? undefined } })
    chats.put(chat); replies.value[item.id] = ''
  })
}
async function reject(item: CodeReviewItem) {
  await run(() => codeEndpoints.rejectTaskItem({ params: { projectId: props.task.project_id, reviewId: item.review_id, itemId: item.id }, query: query(), body: { resolution: 'reject' } }))
}
async function openFile(path: string) {
  opened.value = path; selection.value = undefined; file.value = undefined
  const target = props.task.id
  try {
    const result = await tasksEndpoints.checkFile({ params: params(), query: { file: path } })
    if (opened.value === path && props.task.id === target) file.value = result
  } catch (cause) { error.value = String(cause) }
}
async function addRemark() {
  await run(async () => {
    const value = selection.value
    const result = await codeEndpoints.addTaskItem({ params: { projectId: props.task.project_id }, query: query(), body: {
      origin: 'task', origin_id: props.task.id, scope: value ? 'line' : 'file', file: opened.value,
      side: value?.side ?? 'new', line_start: value?.startLine, line_end: value?.endLine, kind: 'fix', text: note.value,
    } })
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
watch(() => props.task.id, () => { data.value = undefined; selected.value = []; opened.value = ''; file.value = undefined; void load() }, { immediate: true })
</script>
<style scoped>
.work-check { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.check-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.check-summary { font-size: var(--fs-md); color: var(--text-muted); }
.check-spacer { flex: 1; }
.check-error { padding: 6px 16px; color: var(--danger-hover); }
.check-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr) minmax(320px, 2fr); }
.check-files, .check-diff, .check-side { min-height: 0; overflow: auto; }
.check-files { padding: 8px; border-right: 1px solid var(--border); }
.check-diff { padding: 12px; }
.check-side { display: flex; flex-direction: column; border-left: 1px solid var(--border); overflow: hidden; }
.file-row { display: flex; align-items: center; gap: 4px; border-radius: var(--radius-sm); }
.file-row.active { background: var(--bg3); }
.side-body { flex: 1; min-height: 0; overflow: auto; padding: 8px; }
.side-body.chat { overflow: hidden; }
.remark, details { padding: 10px; margin: 8px 0; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.remark-actions { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.muted { font-size: var(--fs-md); color: var(--text-muted); }
:deep(.code-view) { height: 400px; }
</style>
