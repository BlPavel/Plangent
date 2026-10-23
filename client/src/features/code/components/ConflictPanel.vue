<template>
  <div v-if="op" class="cp">
    <div class="cp-head">
      <div class="cp-title">{{ operationTitle(op) }}</div>
      <div v-if="op.commit" class="cp-sub">{{ op.kind === 'merge' ? 'Вливается' : 'Применяется' }} <code>{{ op.commit.sha.slice(0, 7) }}</code> «{{ op.commit.subject }}»</div>
    </div>

    <div v-if="store.working" class="cp-status" role="status">
      <span>Агент разбирает конфликты…</span>
      <AppButton variant="ghost" size="xs" :disabled="store.busy" @click="store.stopAgent()">Остановить</AppButton>
    </div>
    <div v-else-if="session?.status === 'error'" class="cp-error" role="alert">Агент остановился с ошибкой: {{ session.reason }}</div>
    <div v-if="store.error" class="cp-error" role="alert">{{ store.error }}</div>

    <form v-if="!store.working && canSend" class="cp-send" @submit.prevent="send">
      <input v-model="note" class="control control-sm" placeholder="Пожелание агенту (необязательно)" aria-label="Пожелание агенту" />
      <AppButton type="submit" variant="blue" size="sm" :disabled="store.busy">{{ sendLabel }}</AppButton>
    </form>
    <p v-if="!files.length" class="cp-muted">Конфликтов нет. Продолжите в своём git-клиенте: <code>{{ continueCommand(op) }}</code></p>

    <ul v-else class="cp-files">
      <li v-for="file in files" :key="file.path" class="cp-file">
        <div class="cp-row">
          <button type="button" class="cp-path" :title="'Открыть ' + file.path" @click="emit('open', file.path)">{{ file.path }}</button>
          <span class="cp-badge" :class="badgeOf(file).tone" :title="CODES[file.code] ?? ''">{{ badgeOf(file).label }}</span>
        </div>
        <p v-if="file.note" class="cp-note">{{ file.note.text }}</p>
        <template v-if="file.conflicted && file.note && file.note.outcome !== 'resolved'">
          <p v-if="file.note.answer && file.note.answer_sent" class="cp-answer">Ваш ответ: {{ file.note.answer }}</p>
          <form v-else class="cp-reply" @submit.prevent="saveAnswer(file.path)">
            <textarea v-model="drafts[file.path]" class="control control-sm" rows="2" placeholder="Ответ агенту" :aria-label="'Ответ агенту по ' + file.path" />
            <div class="cp-reply-actions">
              <span v-if="file.note.answer" class="cp-muted">Сохранён, уйдёт с «Отправить ответы»</span>
              <AppButton type="submit" variant="ghost" size="xs" :disabled="store.busy || (drafts[file.path] ?? '').trim() === file.note.answer">Сохранить ответ</AppButton>
            </div>
          </form>
        </template>
      </li>
    </ul>

    <div v-if="store.state?.summary" class="cp-summary">
      <div class="cp-label">Итог агента</div>
      <p class="cp-note">{{ store.state.summary }}</p>
    </div>
    <p v-if="files.length" class="cp-muted">
      Проверьте файлы и отметьте их «к коммиту» в «Изменениях» (это git add). Затем продолжите в своём git-клиенте: <code>{{ continueCommand(op) }}</code>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useConflictsStore } from '../stores/conflicts'
import { operationTitle, continueCommand } from '../utils/operation'
import type { ConflictFile } from '../git-types'

/** The card of the developer's merge/rebase: the agent edits the conflicted files, the developer checks, stages and continues. */
const emit = defineEmits<{ open: [path: string] }>()
const store = useConflictsStore()
const op = computed(() => store.operation)
const session = computed(() => store.state?.session ?? null)
const files = computed(() => store.state?.files ?? [])
const note = ref('')
const drafts = ref<Record<string, string>>({})
watch(files, list => {
  for (const file of list) if (file.note && !file.note.answer_sent && drafts.value[file.path] === undefined) drafts.value[file.path] = file.note.answer
}, { immediate: true })

const CODES: Record<string, string> = {
  UU: 'Изменён с обеих сторон', AA: 'Добавлен с обеих сторон', DD: 'Удалён с обеих сторон',
  DU: 'Удалён в ours, изменён в theirs', UD: 'Изменён в ours, удалён в theirs', AU: 'Добавлен только в ours', UA: 'Добавлен только в theirs',
}
function badgeOf(file: ConflictFile): { label: string; tone: string } {
  if (!file.conflicted) return { label: 'добавлен к коммиту', tone: 'ok' }
  if (file.note?.outcome === 'resolved') return { label: 'решён — проверьте', tone: 'info' }
  if (file.note?.outcome === 'question') return { label: 'вопрос', tone: 'warn' }
  if (file.note?.outcome === 'recommend') return { label: 'нужно ваше действие', tone: 'warn' }
  return { label: 'конфликт', tone: 'bad' }
}
const canSend = computed(() => store.conflicted.length > 0 || store.pendingAnswers > 0)
const sendLabel = computed(() => store.pendingAnswers ? `Отправить ответы (${store.pendingAnswers})` : session.value ? 'Разобрать ещё раз' : 'Разрешить с агентом')
async function send() {
  await store.resolve(note.value.trim() || undefined)
  if (!store.error) note.value = ''
}
const saveAnswer = (path: string) => store.answer(path, drafts.value[path] ?? '')
</script>

<style scoped>
.cp { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; font-size: 12.5px; }
.cp-head { display: flex; flex-direction: column; gap: 2px; }
.cp-title { font-weight: 600; color: var(--text); }
.cp-sub { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-status { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.cp-status span { flex: 1; }
.cp-error { padding: 6px 8px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); white-space: pre-wrap; }
.cp-send { display: flex; gap: 6px; }
.cp-send input { flex: 1; min-width: 0; }
.cp-files { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.cp-file { display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg2); }
.cp-row { display: flex; align-items: center; gap: 6px; }
.cp-path { flex: 1; min-width: 0; padding: 0; font: inherit; text-align: left; color: var(--blue-hover); background: none; border: none; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-path:hover { text-decoration: underline; }
.cp-badge { flex-shrink: 0; padding: 1px 6px; font-size: 11px; border-radius: 8px; background: var(--bg3); color: var(--text-muted); }
.cp-badge.ok { color: var(--diff-add, #3fb950); }
.cp-badge.info { color: var(--blue-hover); }
.cp-badge.warn { color: var(--warning-text); background: var(--warning-soft); }
.cp-badge.bad { color: var(--danger-hover); }
.cp-note { margin: 0; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.cp-answer { margin: 0; color: var(--text-muted); white-space: pre-wrap; }
.cp-reply { display: flex; flex-direction: column; gap: 4px; }
.cp-reply textarea { resize: vertical; }
.cp-reply-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.cp-summary { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-left: 3px solid var(--blue); background: var(--bg2); }
.cp-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.cp-muted { margin: 0; font-size: 11.5px; color: var(--text-muted); }
</style>
