<template>
  <section class="review-tab" :aria-busy="busy">
    <div v-if="error" role="alert" class="rt-alert">{{ error }} <button type="button" class="btn btn-subtle btn-xs" aria-label="Скрыть" @click="error = ''">✕</button></div>
    <div v-if="isGroup" class="rt-row rt-pick">
      <label>Проект группы
        <select v-model="memberId" class="control control-sm" aria-label="Проект группы" @change="reset"><option value="">Выберите проект</option><option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option></select>
      </label>
    </div>
    <div v-if="!scope" class="empty-state small">Выберите проект, чтобы посмотреть ветку.</div>
    <template v-else-if="!detail">
      <div class="rt-entry">
        <div class="rt-title">
          <h2>Ревью ветки</h2>
          <span class="muted">Читайте изменения ветки и обсуждайте их с агентом. Замечания пишите на GitHub или GitLab, код агент не меняет.</span>
        </div>
        <form class="rt-form" @submit.prevent="open">
          <label>Ветка для ревью
            <select v-model="branch" class="control" aria-label="Ветка для ревью" :disabled="busy"><option value="">Выберите ветку</option><option v-for="b in list" :key="b.ref" :value="b.ref">{{ label(b) }}</option></select>
          </label>
          <label>Сравнить с
            <select v-model="baseRef" class="control" aria-label="Сравнить с" :disabled="busy"><option value="">Выберите ветку</option><option v-for="b in list" :key="b.ref" :value="b.ref">{{ label(b) }}</option></select>
          </label>
          <div class="rt-row">
            <button class="btn btn-blue" :disabled="busy || !branch || !baseRef">Открыть ревью</button>
            <button type="button" class="btn btn-subtle" :disabled="busy" title="git fetch origin: подтянуть новые ветки и коммиты" @click="fetchAll">{{ busy ? 'Загрузка…' : 'Подтянуть с origin' }}</button>
          </div>
        </form>
        <div v-if="!busy && !list.length" class="empty-state small">Веток нет. Нажмите «Подтянуть с origin».</div>
      </div>
    </template>
    <template v-else>
      <header class="rt-head">
        <div class="rt-row">
          <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="back">← К выбору ветки</button>
          <h3><code>{{ detail.review.branch_name }}</code> <span class="muted">→ сравнение с</span> <code>{{ detail.review.base_name }}</code></h3>
          <span class="rt-spacer" />
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" title="git fetch origin и пересчёт изменений" @click="refresh">{{ busy ? 'Загрузка…' : 'Подтянуть изменения' }}</button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || chatBusy" title="Вопрос агенту про всю ветку" @click="discuss()">{{ chatBusy ? 'Готовим копию кода…' : '💬 Спросить про ветку' }}</button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" title="Удалить копию кода для агента; чаты останутся в истории" @click="finish">Завершить ревью</button>
        </div>
        <div class="rt-row rt-meta">
          <span>Коммитов: {{ detail.commit_count }} · файлов: {{ detail.files.length }} · просмотрено {{ viewedCount }}/{{ detail.files.length }}</span>
          <span class="rt-spacer" />
          <span v-if="detail.rewritten" class="status-badge progress" title="История ветки была переписана (force-push)">История ветки переписана</span>
          <template v-if="detail.new_commits">
            <span class="status-badge progress">Новых коммитов: {{ detail.new_commits }}</span>
            <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="acknowledge">Принять</button>
          </template>
          <button v-else-if="detail.rewritten" type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="acknowledge">Принять</button>
          <details class="rt-commits">
            <summary>Коммиты</summary>
            <ul><li v-for="c in detail.commits" :key="c.sha"><code>{{ c.sha.slice(0, 8) }}</code> {{ c.subject }} <span class="muted">{{ c.author }}</span></li></ul>
          </details>
        </div>
      </header>
      <div class="workspace">
        <nav class="files" aria-label="Файлы ветки">
          <div class="files-head">Файлы</div>
          <div v-for="file in detail.files" :key="file.path" class="file" :class="{ selected: path === file.path, viewed: file.viewed === 'viewed' }">
            <input type="checkbox" :checked="file.viewed === 'viewed'" :disabled="busy" :aria-label="'Просмотрено: ' + file.path" title="Просмотрено" @change="viewed(file.path, ($event.target as HTMLInputElement).checked)" />
            <button type="button" :title="file.path" @click="choose(file.path)">
              <span class="file-name">{{ baseName(file.path) }}</span>
              <span class="file-dir">{{ dirName(file.path) }}</span>
            </button>
            <span class="file-stat"><span v-if="file.added" class="add">+{{ file.added }}</span> <span v-if="file.deleted" class="del">−{{ file.deleted }}</span></span>
            <span v-if="file.status !== 'M'" class="file-tag" :class="file.status === 'A' ? 'add' : file.status === 'D' ? 'del' : ''">{{ file.status }}</span>
            <span v-if="file.viewed === 'changed'" class="file-dot" title="Изменился после того, как вы его отметили" />
          </div>
        </nav>
        <main class="diff-area">
          <BranchDiff v-if="selectedFile" :key="detail.review.id + ':' + path" :scope="scope" :review-id="detail.review.id" :head="detail.review.head" :file="selectedFile" :selection="selection" @select="selection = $event">
            <template #composer>
              <div class="composer" @keydown.esc.stop.prevent="selection = null">
                <strong>Строка {{ selection?.startLine }}{{ selection && selection.endLine !== selection.startLine ? '–' + selection.endLine : '' }}</strong>
                <span class="rt-spacer" />
                <button type="button" class="btn btn-blue btn-sm" :disabled="chatBusy" @click="discuss(selection!)">{{ chatBusy ? 'Готовим копию кода…' : '💬 Обсудить с агентом' }}</button>
                <button type="button" class="btn btn-subtle btn-sm" @click="selection = null">Закрыть</button>
              </div>
            </template>
          </BranchDiff>
          <div v-else class="empty-state">В этом диапазоне нет изменённых файлов.</div>
        </main>
        <aside v-if="chat" class="private-chat">
          <div class="private-head"><strong>{{ chatTitle }}</strong><span class="muted">код не меняется</span><span class="rt-spacer" /><button type="button" class="btn btn-subtle btn-xs" @click="chat = ''">Скрыть</button></div>
          <ChatView :key="chat" :session-id="chat" />
        </aside>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChatView } from '@features/agent-chat'
import { useAppStore } from '@core/stores/app'
import type { LineSelection } from '@shared/code-viewer'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchRef, BranchReview, ReviewThread } from '../types'
import BranchDiff from '../components/BranchDiff.vue'

/** Passed for a group: the review works on one of its projects. */
const props = defineProps<{ projectId: string; members?: { id: string; name: string }[] }>()
const app = useAppStore()
const isGroup = computed(() => !!props.members)
const memberId = ref('')
const scope = computed(() => isGroup.value ? memberId.value : props.projectId)
const detail = ref<BranchReview>(), list = ref<BranchRef[]>([]), branch = ref(''), baseRef = ref(''), error = ref(''), busy = ref(false)
const path = ref(''), selection = ref<LineSelection | null>(null), chat = ref(''), chatTitle = ref('Чат с агентом'), chatBusy = ref(false)
let alive = true
onBeforeUnmount(() => { alive = false })

const selectedFile = computed(() => detail.value?.files.find(f => f.path === path.value))
const viewedCount = computed(() => detail.value?.files.filter(f => f.viewed === 'viewed').length ?? 0)
const baseName = (value: string) => value.split('/').pop() ?? value
const dirName = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : ''
const label = (b: BranchRef) => b.remote ? 'origin/' + b.name : b.name

async function run<T>(fn: () => Promise<T>, accept?: (value: T) => void) {
  if (busy.value) return undefined
  busy.value = true
  error.value = ''
  try { const result = await fn(); if (alive) accept?.(result); return result }
  catch (cause) { if (alive) error.value = errorText(cause); return undefined }
  finally { if (alive) busy.value = false }
}
const acceptList = (value: { branches: BranchRef[]; current: string | null; default_base: string | null }) => {
  list.value = value.branches
  if (!baseRef.value) baseRef.value = value.default_base ?? ''
  if (!branch.value && value.current) branch.value = value.branches.find(b => !b.remote && b.name === value.current)?.ref ?? ''
}
const acceptDetail = (value: BranchReview) => {
  detail.value = value
  if (!value.files.some(f => f.path === path.value)) path.value = value.files[0]?.path ?? ''
}
const loadBranches = () => scope.value ? run(() => branchReviewApi.branches(scope.value), acceptList) : undefined
const fetchAll = () => run(() => branchReviewApi.fetch(scope.value), acceptList)
const open = () => run(() => branchReviewApi.open(scope.value, branch.value, baseRef.value), acceptDetail)
const refresh = () => run(() => branchReviewApi.refresh(scope.value, detail.value!.review.id), acceptDetail)
const acknowledge = () => run(() => branchReviewApi.acknowledge(scope.value, detail.value!.review.id), acceptDetail)
const viewed = (file: string, value: boolean) => run(() => branchReviewApi.viewed(scope.value, detail.value!.review.id, file, value), acceptDetail)
function choose(value: string) { path.value = value; selection.value = null }
function back() { detail.value = undefined; selection.value = null; chat.value = ''; void loadBranches() }
function reset() { detail.value = undefined; list.value = []; branch.value = ''; baseRef.value = ''; chat.value = ''; selection.value = null; void loadBranches() }

async function discuss(line?: LineSelection) {
  if (!detail.value || chatBusy.value) return
  chatBusy.value = true
  try {
    const thread = await branchReviewApi.openThread(scope.value, detail.value.review.id, line ? { path: line.path, side: line.side, line: line.startLine } : {})
    if (!alive) return
    chatTitle.value = line ? 'Чат · ' + baseName(line.path) + ':' + line.startLine : 'Чат · вся ветка'
    chat.value = thread.session_id
    selection.value = null
  } catch (cause) { error.value = errorText(cause) } finally { chatBusy.value = false }
}
async function finish() {
  if (!detail.value || !await app.confirm('Завершить ревью? Копия кода для агента будет удалена, чаты останутся в истории.', { confirmLabel: 'Завершить ревью' })) return
  try { await branchReviewApi.finish(scope.value, detail.value.review.id); chat.value = ''; back() } catch (cause) { error.value = errorText(cause) }
}
watch(() => detail.value?.review.id, async id => {
  chat.value = ''
  if (!id) return
  try {
    const threads: ReviewThread[] = await branchReviewApi.threads(scope.value, id)
    const last = threads.at(-1)
    if (alive && detail.value?.review.id === id && last) { chat.value = last.session_id; chatTitle.value = last.path ? 'Чат · ' + baseName(last.path) + ':' + last.line : 'Чат · вся ветка' }
  } catch (cause) { if (alive) error.value = errorText(cause) }
})
void loadBranches()
</script>
<style scoped>
.review-tab { height: 100%; display: flex; flex-direction: column; min-height: 0; font-size: 13px; }
.rt-alert { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 16px; font-size: 12px; color: var(--danger-hover); background: var(--danger-soft); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.rt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rt-pick { padding: 8px 16px; border-bottom: 1px solid var(--border); }
.rt-pick label, .rt-form label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
.rt-spacer { flex: 1; }
.rt-entry { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 720px; margin: 0 auto; padding: 24px 20px; overflow: auto; }
.rt-title { display: flex; flex-direction: column; gap: 2px; }
.rt-title h2 { font-size: 16px; }
.rt-form { display: flex; flex-direction: column; gap: 10px; }
.rt-form label { flex-direction: column; align-items: stretch; gap: 4px; }
code { font-size: 11.5px; }
.rt-head { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.rt-head h3 { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-meta { font-size: 12px; color: var(--text-muted); }
.rt-commits { width: 100%; }
.rt-commits summary { cursor: pointer; font-size: 12px; }
.rt-commits ul { max-height: 160px; overflow: auto; margin: 4px 0 0; padding-left: 16px; font-size: 12px; }
.workspace { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.files { width: 260px; flex-shrink: 0; overflow: auto; border-right: 1px solid var(--border); }
.files-head { padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.file { display: flex; align-items: center; gap: 6px; padding: 3px 8px; }
.file:hover { background: var(--bg-hover); }
.file.selected { background: var(--blue-soft); }
.file input { margin: 0; flex-shrink: 0; accent-color: var(--blue); }
.file button { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 2px 0; font: inherit; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.file.viewed .file-name { color: var(--text-muted); }
.file-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-dir { font-size: 10.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-stat { flex-shrink: 0; font-size: 10.5px; }
.file-stat .add, .file-tag.add { color: #3fb950; }
.file-stat .del, .file-tag.del { color: var(--danger-hover); }
.file-tag { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--blue-hover); }
.file-dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--warning-text); }
.diff-area { flex: 1; min-width: 0; overflow: auto; display: flex; flex-direction: column; }
.diff-area > div { flex: 1; }
.composer { display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); font-size: 12px; }
.private-chat { width: 400px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); }
.private-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; border-bottom: 1px solid var(--border); }
.private-chat > :last-child { flex: 1; min-height: 0; }
</style>
