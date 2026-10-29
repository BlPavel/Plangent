<template>
  <section class="task-git">
    <div class="tg-line">
      <button type="button" class="tg-toggle" :aria-expanded="open" title="Подробности: текущая ветка, точка отсчёта изменений" @click="open = !open">
        <svg :class="{ open }" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span class="section-label">Ветка</span>
      </button>
      <code class="tg-branch" :class="{ none: !task.branch_name }">{{ task.branch_name || current || 'не выбрана' }}</code>
      <span v-if="task.base_commit" class="muted" :title="'Изменения задачи считаются от ' + task.base_commit">от <code>{{ task.base_commit.slice(0, 7) }}</code></span>
      <span v-if="frozen" class="muted">· очередь выполняется</span>
      <span class="spacer" />
      <span v-if="ready && !git.repository" class="muted">нет репозитория</span>
      <template v-else>
        <span v-if="branchMissing" class="tg-warning" :title="'Ветки ' + task.branch_name + ' нет в репозитории'">⚠ ветки нет в репозитории</span>
        <template v-else-if="mismatch">
          <span class="tg-warning" :title="'Вы на ветке ' + (current || 'HEAD отделён') + ', задача на ' + task.branch_name">⚠ вы на {{ current || 'HEAD' }}</span>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || frozen || !!git.writeBlocked" :title="frozen ? 'Остановите очередь, чтобы сменить ветку' : git.writeBlocked || 'Переключиться на ветку задачи'" @click="switchToTask">Переключиться</button>
        </template>
        <div class="tg-picker">
          <AppButton type="button" size="xs" :disabled="busy || frozen || !!git.writeBlocked || !git.repository" :title="frozen ? 'Остановите очередь, чтобы сменить ветку' : git.writeBlocked || 'Переключить ветку или создать новую; она станет веткой задачи'" @click="picker = !picker">Сменить</AppButton>
          <BranchPicker v-if="picker" :task="task" :on-select-branch="saveBranch" @close="picker = false" />
        </div>
      </template>
    </div>

    <div v-if="open" class="tg-details">
      <p v-if="ready && !git.repository" class="muted">Репозиторий не найден. Выбор ветки недоступен, а ревью задачи проверит только файлы из отчётов исполнителей.</p>
      <template v-else>
        <div>Ветка задачи: <code>{{ task.branch_name || 'Не выбрана' }}</code><span v-if="!task.branch_name" class="muted"> — задача работает в текущей ветке</span></div>
        <div>Текущая ветка: <code>{{ current || (git.repository?.detached ? 'HEAD отделён' : 'Нет ветки') }}</code></div>
        <div class="tg-base">
          <span v-if="task.base_commit">Изменения задачи считаются от <code :title="task.base_commit">{{ task.base_commit.slice(0, 7) }}</code></span>
          <span v-else class="muted">Точка отсчёта — коммит HEAD в момент первого запуска очереди. Что уже лежит в дереве незакоммиченным, попадёт в изменения задачи.</span>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || frozen || !!git.writeBlocked || !git.repository?.head" :title="frozen ? 'Пока очередь выполняется, точку отсчёта менять нельзя' : git.writeBlocked || 'Ревью задачи будет видеть только изменения после текущего коммита'" @click="resetBaseCommit">Считать от текущего коммита</button>
        </div>
      </template>
      <p v-if="frozen" class="muted">Очередь выполняется: ветку и точку отсчёта менять нельзя. Остановите очередь, если нужно.</p>
      <p v-if="git.writeBlocked" class="muted">Ветку пока менять нельзя: {{ git.writeBlocked }}</p>
    </div>
    <p v-if="error" role="alert" class="tg-error">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { api } from '@core/api'
import { BranchPicker, useGitStore } from '@features/code'
import { errorText } from '@shared/utils/errorText'
import { useAppStore } from '@core/stores/app'
import type { Task } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'

const props = defineProps<{ projectId: string; task: Task; frozen?: boolean }>()
const emit = defineEmits<{ updated: [task: Task] }>()
const git = useGitStore(), app = useAppStore()
const busy = ref(false), picker = ref(false), open = ref(false), error = ref('')
const current = computed(() => git.repository?.detached ? '' : git.repository?.branch ?? '')
const ready = ref(false)
const mismatch = computed(() => !!props.task.branch_name && props.task.branch_name !== current.value && !!git.repository)
const branchMissing = computed(() => !!props.task.branch_name && git.branches.length > 0 && !git.branches.some(b => b.name === props.task.branch_name))
watch(() => props.projectId, id => { picker.value = false; ready.value = false; void git.start(id).finally(() => { if (id === props.projectId) ready.value = true }) }, { immediate: true })
watch(() => props.task.id, () => { picker.value = false; open.value = false; error.value = '' })
onBeforeUnmount(() => { if (git.projectId === props.projectId) git.stop() })

async function saveBranch(branch: string) {
  const projectId = props.projectId, taskId = props.task.id
  busy.value = true
  try {
    const task = await api.patch<Task>('/projects/' + encodeURIComponent(projectId) + '/tasks/' + encodeURIComponent(taskId), { branch_name: branch })
    if (projectId === props.projectId && taskId === props.task.id) emit('updated', task)
  } finally { busy.value = false }
}
async function switchToTask() {
  if (busy.value || props.frozen || git.writeBlocked || !props.task.branch_name) return
  busy.value = true; error.value = ''
  try { await git.run('switch', { branch: props.task.branch_name }) }
  catch (cause) { error.value = errorText(cause) }
  finally { busy.value = false }
}
async function resetBaseCommit() {
  if (busy.value || props.frozen || git.writeBlocked) return
  const head = git.repository?.head?.slice(0, 7) ?? ''
  const previous = props.task.base_commit ? ` Прежняя точка: ${props.task.base_commit.slice(0, 7)}.` : ''
  const ok = await app.confirm(`Ревью задачи будет видеть только изменения после ${head}. Всё, что закоммичено до него, из ревью выпадет.${previous}`, { title: 'Считать изменения задачи от текущего коммита?', confirmLabel: 'Считать' })
  if (!ok) return
  const projectId = props.projectId, taskId = props.task.id
  busy.value = true; error.value = ''
  try {
    const task = await api.post<Task>('/projects/' + encodeURIComponent(projectId) + '/tasks/' + encodeURIComponent(taskId) + '/base-commit', {})
    if (projectId === props.projectId && taskId === props.task.id) emit('updated', task)
  } catch (cause) { error.value = errorText(cause) }
  finally { busy.value = false }
}
</script>
<style scoped>
.task-git { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); font-size: 12px; }
.tg-line { display: flex; align-items: center; gap: 8px; min-height: var(--size-xs); flex-wrap: wrap; }
.tg-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 0; background: none; border: none; color: var(--text-muted); font-family: inherit; cursor: pointer; }
.tg-toggle:hover { color: var(--text); }
.tg-toggle svg { width: 14px; height: 14px; transition: transform 0.15s; }
.tg-toggle svg.open { transform: rotate(90deg); }
.tg-branch { font-weight: 600; min-width: 0; max-width: min(45%, 320px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tg-branch.none { font-weight: 400; color: var(--text-muted); }
.tg-details { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.tg-base { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.spacer { flex: 1; }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
.tg-picker { position: relative; }
.tg-picker :deep(.branches) { left: auto; right: 0; max-width: calc(100vw - 48px); }
.tg-warning { color: var(--warning-text); }
.muted { color: var(--text-muted); }
.tg-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
