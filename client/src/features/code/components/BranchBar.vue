<template>
  <div v-if="git.repository" class="branch-bar">
    <div v-if="feedback" class="bb-feedback" :class="{ failed: !!git.error }" role="status">
      <div class="bb-feedback-head">
        <span v-if="git.operationId">{{ labelOf(git.lastAction) }} выполняется…</span>
        <span v-else-if="git.error" role="alert">{{ labelOf(git.lastAction) }}: {{ git.error }}</span>
        <span v-else>{{ labelOf(git.lastAction) }}: готово</span>
        <span class="bb-spacer" />
        <button v-if="git.operationId && git.lastAction !== 'fetch'" type="button" class="btn btn-ghost btn-xs" @click="git.cancel()">Отменить</button>
        <button v-else-if="!git.operationId" type="button" class="btn btn-subtle btn-xs" aria-label="Скрыть" title="Скрыть" @click="git.dismiss()">✕</button>
      </div>
      <pre v-if="git.output" aria-label="Вывод git">{{ git.output }}</pre>
    </div>
    <div class="bb-row">
      <div class="bb-branch">
        <button
          type="button" class="bb-name" :disabled="!!git.blocked" :aria-expanded="choosing"
          :title="git.blocked || 'Переключить ветку или создать новую'" @click="choosing = !choosing"
        ><span class="bb-icon">⎇</span>{{ branchName }}<span class="bb-caret">▾</span></button>
        <BranchPicker v-if="choosing" :task="task" up @close="choosing = false" />
      </div>
      <span v-if="git.repository.upstream" class="bb-sync" :title="`Относительно ${git.repository.upstream}: ↑ не отправлено, ↓ ещё не подтянуто`">
        <span :class="{ on: git.repository.ahead }">↑{{ git.repository.ahead }}</span> <span :class="{ on: git.repository.behind }">↓{{ git.repository.behind }}</span>
      </span>
      <span v-else class="bb-sync" title="Ветки нет в origin">локальная</span>
      <span class="bb-spacer" />
      <SplitButton :items="menu" :disabled="!!git.blocked || git.repository.detached" :menu-disabled="!!git.blocked" :title="git.blocked || primary.title" @click="run(primary.id)">
        {{ running === primary.id ? primary.label + '…' : primary.label }}
      </SplitButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import SplitButton from '@shared/ui/SplitButton.vue'
import type { MenuItem } from '@shared/ui/AppMenu.vue'
import { useGitStore } from '../stores/git'
import { useCodeStore } from '../stores/code'
import { useAppStore } from '@core/stores/app'
import BranchPicker from './BranchPicker.vue'

defineProps<{ task?: { key: string } | null }>()
const NAMES: Record<string, string> = { fetch: 'Fetch', pull: 'Pull', 'pull-rebase': 'Pull --rebase', 'push-force': 'Force push', push: 'Push', switch: 'Переключение ветки', branch: 'Создание ветки', stage: 'Добавление к коммиту', unstage: 'Исключение из коммита' }
const labelOf = (action: string) => NAMES[action] ?? 'Git'
const app = useAppStore(), git = useGitStore(), code = useCodeStore(), choosing = ref(false)
const branchName = computed(() => git.repository?.detached ? 'вне ветки' : git.repository?.branch || 'вне ветки')
const running = computed(() => git.operationId ? git.lastAction : '')
const published = computed(() => !!git.repository?.upstream)
/** The button offers what the branch needs now: publish, pull, push — or just a fetch. */
const primary = computed(() => {
  const repo = git.repository
  if (!published.value) return { id: 'push', label: '↑ Опубликовать', title: 'Отправить ветку в origin и связать с ней' }
  if (repo?.behind) return { id: 'pull', label: `↓ Pull ${repo.behind}`, title: 'Подтянуть коммиты из origin' }
  if (repo?.ahead) return { id: 'push', label: `↑ Push ${repo.ahead}`, title: 'Отправить коммиты в origin' }
  return { id: 'fetch', label: 'Fetch', title: 'Получить новые коммиты и ветки из origin, рабочую папку не менять' }
})
const menu = computed<MenuItem[]>(() => [
  { label: 'Fetch', hint: 'Получить новое из origin, ничего не меняя', action: () => run('fetch') },
  { label: 'Pull', hint: 'Подтянуть коммиты (только fast-forward)', disabled: !published.value, action: () => run('pull') },
  { label: 'Pull --rebase', hint: 'Подтянуть коммиты, переложив ваши локальные поверх них. При конфликте отменяется', disabled: !published.value, action: () => run('pull-rebase') },
  { separator: true },
  { label: published.value ? 'Push' : 'Опубликовать', hint: published.value ? 'Отправить коммиты в origin' : 'Создать ветку в origin', action: () => run('push') },
  { label: 'Force push', hint: 'Перезаписать ветку в origin (с проверкой, что там нет чужих коммитов)', danger: true, disabled: !published.value, action: () => void forcePush() },
  { separator: true },
  { label: 'Diff ветки', hint: git.baseRef ? 'Все изменения ветки относительно ' + git.baseRef : 'Нет веток origin: сделайте Fetch', disabled: !git.baseRef, action: () => void code.setBase('remote', git.baseRef) },
])
/** The commit box shows commits itself, the open branch picker — its own errors; quiet stage/unstage successes are not worth a line. */
const feedback = computed(() => !!git.lastAction && git.lastAction !== 'commit' && !choosing.value && (!!git.operationId || !!git.error || ['fetch', 'pull', 'pull-rebase', 'push', 'push-force'].includes(git.lastAction) && !!git.output))
async function forcePush() {
  if (await app.confirm('Перезаписать ветку в origin вашей версией? Если там появились чужие коммиты, git откажется.', { confirmLabel: 'Force push' })) await run('push-force')
}
async function run(action: string) { try { await git.run(action) } catch { /* shown in the feedback block */ } }
</script>

<style scoped>
.branch-bar { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--border); font-size: 12px; }
.bb-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.bb-branch { position: relative; min-width: 0; }
.bb-name { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2px 4px; font: inherit; font-weight: 600; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bb-name:hover:not(:disabled) { background: var(--bg3); }
.bb-name:disabled { cursor: default; color: var(--text-muted); }
.bb-icon, .bb-caret { flex-shrink: 0; font-weight: 400; color: var(--text-muted); }
.bb-caret { font-size: 10px; }
.bb-sync { flex-shrink: 0; color: var(--text-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.bb-sync .on { color: var(--warning-text); font-weight: 600; }
.bb-spacer { flex: 1; }
.bb-feedback { padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg2); color: var(--text-muted); }
.bb-feedback.failed { background: var(--danger-soft); color: var(--danger-hover); }
.bb-feedback-head { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.bb-feedback pre { margin-top: 6px; max-height: 140px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11.5px; color: var(--text-muted); }
</style>
