<template>
  <div v-if="git.repository" class="git-head">
    <div class="gh-branch">
      <button
        type="button" class="btn btn-ghost btn-sm" :disabled="!!git.blocked" :aria-expanded="choosing"
        :title="git.blocked || 'Переключить или создать ветку'" @click="choosing = !choosing"
      >⎇ {{ git.repository.detached ? 'вне ветки' : git.repository.branch || 'вне ветки' }} <span class="gh-caret">▾</span></button>
      <BranchPicker v-if="choosing" :task="task" @close="choosing = false" />
    </div>
    <span v-if="git.repository.upstream" class="gh-sync" :title="`Относительно ${git.repository.upstream}: ↑ коммиты не отправлены, ↓ коммиты ещё не подтянуты`">
      <span :class="{ on: git.repository.ahead }">↑{{ git.repository.ahead }}</span> <span :class="{ on: git.repository.behind }">↓{{ git.repository.behind }}</span>
    </span>
    <span v-else class="gh-sync" title="У ветки нет пары в origin: первый push её опубликует">не опубликована</span>
    <div class="gh-actions">
      <button
        v-for="action in ACTIONS" :key="action.id" type="button" class="btn btn-subtle btn-sm"
        :disabled="!!git.blocked" :title="git.blocked || action.title" @click="run(action.id)"
      >{{ running === action.id ? action.label + '…' : action.label }}</button>
    </div>
    <span v-if="git.blocked" class="status-badge progress" :title="git.blocked">{{ git.blocked }}</span>
    <div v-if="feedback" class="gh-feedback" :class="{ failed: !!git.error }" role="status">
      <div class="gh-feedback-head">
        <span v-if="git.operationId">{{ labelOf(git.lastAction) }} выполняется…</span>
        <span v-else-if="git.error" role="alert">{{ labelOf(git.lastAction) }}: {{ git.error }}</span>
        <span v-else>{{ labelOf(git.lastAction) }}: готово</span>
        <span class="gh-spacer" />
        <button v-if="git.operationId" type="button" class="btn btn-ghost btn-xs" @click="git.cancel()">Отменить</button>
        <button v-else type="button" class="btn btn-subtle btn-xs" aria-label="Скрыть" title="Скрыть" @click="git.dismiss()">✕</button>
      </div>
      <pre v-if="git.output" aria-label="Вывод git">{{ git.output }}</pre>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGitStore } from '../stores/git'
import BranchPicker from './BranchPicker.vue'
defineProps<{ task?: { key: string } | null }>()
const ACTIONS = [
  { id: 'fetch', label: 'Fetch', title: 'Получить новые коммиты и ветки из origin, рабочую папку не менять' },
  { id: 'pull', label: 'Pull', title: 'Подтянуть коммиты из origin в текущую ветку' },
  { id: 'push', label: 'Push', title: 'Отправить коммиты текущей ветки в origin' },
]
const NAMES: Record<string, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push', switch: 'Переключение ветки', branch: 'Создание ветки', stage: 'Добавление к коммиту', unstage: 'Исключение из коммита' }
const labelOf = (action: string) => NAMES[action] ?? 'Git'
const git = useGitStore(), choosing = ref(false)
const running = computed(() => git.operationId ? git.lastAction : '')
/** The commit panel shows commits itself, the open branch picker — its own errors; quiet stage/unstage successes are not worth a line. */
const feedback = computed(() => !!git.lastAction && git.lastAction !== 'commit' && !choosing.value && (!!git.operationId || !!git.error || ['fetch', 'pull', 'push'].includes(git.lastAction) && !!git.output))
async function run(action: string) { try { await git.run(action) } catch { /* shown in the feedback line */ } }
</script>
<style scoped>
.git-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; flex: 1; min-width: 0; font-size: 12px; }
.gh-branch { position: relative; }
.gh-branch .btn { font-weight: 600; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; line-height: calc(var(--size-sm) - 2px); }
.gh-caret { font-size: 10px; color: var(--text-muted); }
.gh-sync { color: var(--text-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.gh-sync .on { color: var(--warning-text); font-weight: 600; }
.gh-actions { display: flex; gap: 2px; }
.gh-feedback { flex-basis: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg2); color: var(--text-muted); }
.gh-feedback.failed { border-color: var(--danger-soft); background: var(--danger-soft); color: var(--danger-hover); }
.gh-feedback-head { display: flex; align-items: center; gap: 8px; }
.gh-spacer { flex: 1; }
.gh-feedback pre { margin-top: 6px; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11.5px; color: var(--text-muted); }
</style>
