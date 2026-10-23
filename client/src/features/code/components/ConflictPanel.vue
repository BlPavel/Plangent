<template>
  <div v-if="op" class="cp">
    <div class="cp-head">
      <div class="cp-title">{{ operationTitle(op) }}</div>
      <div v-if="op.commit" class="cp-sub">{{ op.kind === 'merge' ? 'Вливается' : 'Применяется' }} <code>{{ op.commit.sha.slice(0, 7) }}</code> «{{ op.commit.subject }}»</div>
    </div>

    <div v-if="session?.status === 'error'" class="cp-error" role="alert">Агент остановился с ошибкой: {{ session.reason }}</div>
    <div v-if="store.error" class="cp-error" role="alert">{{ store.error }}</div>

    <!-- One main action per state: start, wait, answer the agent's questions, or (once everything is handled) ask for a redo. -->
    <form v-if="store.mode === 'start'" class="cp-send" @submit.prevent="send">
      <input ref="noteInput" v-model="note" class="control control-sm" placeholder="Пожелание агенту (необязательно)" aria-label="Пожелание агенту" />
      <AppButton type="submit" variant="blue" size="sm" :disabled="store.busy">Разрешить с агентом</AppButton>
    </form>
    <div v-else-if="store.mode === 'working'" class="cp-status" role="status">
      <span>Агент разбирает конфликты…</span>
      <AppButton variant="ghost" size="xs" :disabled="store.busy" @click="store.stopAgent()">Остановить</AppButton>
    </div>
    <template v-else-if="store.mode === 'done'">
      <form v-if="redoing" class="cp-redo" @submit.prevent="send">
        <textarea
          ref="redoInput" v-model="note" class="control control-sm cp-reply" rows="3" placeholder="Что сделать иначе" aria-label="Что сделать иначе"
          @keydown.esc="redoing = false" @keydown.enter.ctrl.exact.prevent="note.trim() && send()"
        />
        <div class="cp-redo-actions">
          <AppButton variant="ghost" size="sm" @click="redoing = false">Отмена</AppButton>
          <AppButton type="submit" variant="blue" size="sm" :disabled="store.busy || !note.trim()" title="Ctrl+Enter">Переделать</AppButton>
        </div>
      </form>
      <div v-else-if="store.conflicted.length" class="cp-status">
        <span>Агент разобрал все конфликты</span>
        <AppButton variant="ghost" size="xs" title="Попросить агента сделать иначе" @click="redo">Переделать</AppButton>
      </div>
    </template>
    <p v-if="!files.length" class="cp-muted">Конфликтов нет</p>

    <ul v-else class="cp-files">
      <li v-for="file in files" :key="file.path" class="cp-file">
        <div class="cp-row">
          <button type="button" class="cp-path" :title="'Открыть ' + file.path" @click="emit('open', file.path)">{{ file.path }}</button>
          <span class="cp-badge" :class="badgeOf(file).tone" :title="CODES[file.code] ?? ''">{{ badgeOf(file).label }}</span>
        </div>
        <p v-if="file.note" class="cp-note">{{ file.note.text }}</p>
        <p v-if="file.note?.answer && file.note.answer_sent" class="cp-answer">Ваш ответ: {{ file.note.answer }}</p>
        <textarea
          v-else-if="store.mode === 'answer' && asked.has(file.path)" v-model="drafts[file.path]" class="control control-sm cp-reply" rows="2"
          placeholder="Ответ агенту" :aria-label="'Ответ агенту по ' + file.path"
        />
      </li>
    </ul>
    <div v-if="store.mode === 'answer'" class="cp-answers">
      <AppButton variant="blue" size="sm" :disabled="store.busy || !answered" @click="sendAnswers">
        {{ answered ? `Отправить ответы (${answered})` : 'Ответьте на вопросы агента' }}
      </AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useConflictsStore } from '../stores/conflicts'
import { operationTitle } from '../utils/operation'
import type { ConflictFile } from '../git-types'

/** The card of the developer's merge/rebase: the agent edits the conflicted files, the developer checks, stages and continues. */
const emit = defineEmits<{ open: [path: string] }>()
const store = useConflictsStore()
const op = computed(() => store.operation)
const session = computed(() => store.state?.session ?? null)
const files = computed(() => store.state?.files ?? [])
const note = ref(''), noteInput = ref<HTMLInputElement>(), redoInput = ref<HTMLTextAreaElement>(), redoing = ref(false)
/** «Разрешить с агентом» in the banner only brings the card up: the developer may add a wish before starting. */
defineExpose({ focus: () => noteInput.value?.focus() })
async function redo() { redoing.value = true; note.value = ''; await nextTick(); redoInput.value?.focus() }
watch(() => store.mode, () => { redoing.value = false })

/** Replies to the agent's questions, sent together in one turn. */
const drafts = ref<Record<string, string>>({})
const asked = computed(() => new Set(store.questions.map(f => f.path)))
const answered = computed(() => store.questions.filter(f => drafts.value[f.path]?.trim()).length)

const CODES: Record<string, string> = {
  UU: 'Изменён с обеих сторон', AA: 'Добавлен с обеих сторон', DD: 'Удалён с обеих сторон',
  DU: 'Удалён в ours, изменён в theirs', UD: 'Изменён в ours, удалён в theirs', AU: 'Добавлен только в ours', UA: 'Добавлен только в theirs',
}
function badgeOf(file: ConflictFile): { label: string; tone: string } {
  if (!file.conflicted) return { label: 'добавлен к коммиту', tone: 'ok' }
  if (file.note?.outcome === 'resolved') return { label: 'решён — проверьте', tone: 'info' }
  if (file.note?.outcome === 'question') return file.note.answer_sent ? { label: 'ответ отправлен', tone: 'info' } : { label: 'вопрос', tone: 'warn' }
  if (file.note?.outcome === 'recommend') return { label: 'нужно ваше действие', tone: 'warn' }
  return { label: 'конфликт', tone: 'bad' }
}
async function send() {
  await store.resolve({ note: note.value.trim() || undefined })
  if (!store.error) note.value = ''
}
async function sendAnswers() {
  const answers = Object.fromEntries(store.questions.map(f => [f.path, drafts.value[f.path]?.trim() ?? '']).filter(([, text]) => text))
  await store.resolve({ answers })
  if (!store.error) for (const path of Object.keys(answers)) delete drafts.value[path]
}
</script>

<style scoped>
.cp { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; font-size: 12.5px; }
.cp-head { display: flex; flex-direction: column; gap: 2px; }
.cp-title { font-weight: 600; color: var(--text); }
.cp-sub { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-status { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.cp-status span { flex: 1; min-width: 0; }
.cp-error { padding: 6px 8px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); white-space: pre-wrap; }
.cp-send { display: flex; gap: 6px; }
/* `input.control` outranks `.control-sm`: keep the field as tall as the button. */
.cp-send input { flex: 1; min-width: 0; height: var(--size-sm); }
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
/* `textarea.control` has a fixed one-line height. */
.cp-reply { height: auto; padding: 6px 10px; resize: vertical; }
.cp-answers { display: flex; justify-content: flex-end; }
.cp-redo { display: flex; flex-direction: column; gap: 6px; }
.cp-redo-actions { display: flex; justify-content: flex-end; gap: 6px; }
.cp-muted { margin: 0; font-size: 11.5px; color: var(--text-muted); }
</style>
