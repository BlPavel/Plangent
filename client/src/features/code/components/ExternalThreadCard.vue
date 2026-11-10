<template>
  <div class="et" :class="{ resolved: thread.resolved }">
    <div class="et-head">
      <AppBadge  title="Комментарий из GitLab, не тред с агентом">GitLab</AppBadge>
      <span class="et-state" :class="state.tone">{{ state.label }}</span>
      <span class="et-spacer" />
      <AppButton variant="link" size="xs" v-if="canDiscuss" type="button"  title="Создать пункт ревью с этим комментарием и разобрать его с агентом" @click="emit('discuss', thread)">Разобрать с агентом</AppButton>
      <AppButton variant="link" size="xs" type="button"  :disabled="resolving" :title="thread.resolved ? 'Снова открыть обсуждение в GitLab' : 'Пометить обсуждение решённым в GitLab'" @click="toggleResolved">{{ thread.resolved ? 'Открыть снова' : 'Решено' }}</AppButton>
      <AppButton variant="link" size="xs" v-if="!replying" type="button"  @click="replying = true">Ответить</AppButton>
    </div>
    <AppButton v-if="showLocation && thread.path" class="et-place" variant="link" size="xs" block start multiline type="button" :title="thread.path" @click="emit('goto')"><span class="et-path">{{ thread.path }}<template v-if="thread.line">:{{ thread.line }}</template></span></AppButton>
    <div v-for="note in thread.notes" :key="note.id" class="et-note">
      <div class="et-note-head">
        <span class="et-author">{{ note.author }}</span>
        <template v-if="note.mine && editingId !== note.id">
          <AppButton variant="link" size="xs" type="button"  :disabled="noteBusy" @click="startEdit(note)">Изменить</AppButton>
          <AppButton variant="danger-link" size="xs" type="button" :disabled="noteBusy" @click="removeNote(note)">Удалить</AppButton>
        </template>
      </div>
      <form v-if="editingId === note.id" class="et-reply" @submit.prevent="saveEdit(note)" @keydown.esc.stop.prevent="editingId = null">
        <AppTextarea block v-model="editText"  rows="3" spellcheck="false" @keydown.ctrl.enter.prevent="saveEdit(note)" @keydown.meta.enter.prevent="saveEdit(note)" />
        <div class="et-actions">
          <span class="et-muted">Изменение увидят все участники МР</span>
          <AppButton type="button" size="xs" variant="ghost" @click="editingId = null; editText = ''">Отмена</AppButton>
          <AppButton type="submit" size="xs" variant="blue" :disabled="!editText.trim() || noteBusy">{{ noteBusy ? 'Сохранение…' : 'Сохранить в GitLab' }}</AppButton>
        </div>
        <div v-if="error" class="et-error">{{ error }}</div>
      </form>
      <div v-else class="et-body">{{ note.body }}</div>
    </div>
    <div v-if="error && !replying && editingId === null" class="et-error">{{ error }}</div>
    <div v-if="$slots.after" class="et-after"><slot name="after" /></div>
    <form v-if="replying" class="et-reply" @submit.prevent="send" @keydown.esc.stop.prevent="replying = false">
      <AppTextarea block v-model="text"  rows="3" placeholder="Ответ уйдёт в обсуждение GitLab. Ctrl+Enter — отправить" spellcheck="false" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send" />
      <div class="et-actions">
        <span class="et-muted">Ответ увидят все участники МР</span>
        <AppButton type="button" size="xs" variant="ghost" @click="replying = false">Отмена</AppButton>
        <AppButton type="submit" size="xs" variant="blue" :disabled="!text.trim() || busy">{{ busy ? 'Отправка…' : 'Отправить в GitLab' }}</AppButton>
      </div>
      <div v-if="error" class="et-error">{{ error }}</div>
    </form>
  </div>
</template>

<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { useDraft } from '@core/composables/useDraft'
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useExternalThreadsStore } from '../stores/external'
import type { ExternalNote, ExternalThread, ExternalThreadActions } from '../types'

const props = defineProps<{ thread: ExternalThread; showLocation?: boolean; canDiscuss?: boolean; actions?: ExternalThreadActions }>()
const emit = defineEmits<{ goto: []; discuss: [thread: ExternalThread] }>()
const store: ExternalThreadActions = props.actions ?? useExternalThreadsStore()
const app = useAppStore()
const replying = ref(false), text = useDraft(() => `external-thread:${props.thread.id}:reply:text`, () => ''), busy = ref(false), error = ref(''), resolving = ref(false)

/** Where the discussion stands: closed, waiting for the developer's answer or answered and waiting for the colleague. */
const state = computed(() => props.thread.resolved ? { label: 'решено', tone: 'done' } : props.thread.notes.at(-1)?.mine ? { label: 'вы ответили', tone: '' } : { label: 'ждёт ответа', tone: 'wait' })

const editingId = useDraft<number | null>(() => `external-thread:${props.thread.id}:reply:editingId`, () => null), editText = useDraft(() => `external-thread:${props.thread.id}:reply:editText`, () => ''), noteBusy = ref(false)

function startEdit(note: ExternalNote) { editingId.value = note.id; editText.value = note.body; error.value = '' }
async function saveEdit(note: ExternalNote) {
  if (!editText.value.trim() || noteBusy.value) return
  noteBusy.value = true; error.value = ''
  try { await store.editNote(props.thread.id, note.id, editText.value.trim()); editingId.value = null; editText.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось изменить комментарий' }
  finally { noteBusy.value = false }
}
async function removeNote(note: ExternalNote) {
  if (!(await app.confirm('Удалить комментарий в GitLab? Это нельзя отменить.', { confirmLabel: 'Удалить', danger: true }))) return
  noteBusy.value = true; error.value = ''
  try { await store.deleteNote(props.thread.id, note.id) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось удалить комментарий' }
  finally { noteBusy.value = false }
}

async function toggleResolved() {
  resolving.value = true; error.value = ''
  try { await store.resolve(props.thread.id, !props.thread.resolved) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось изменить статус обсуждения' }
  finally { resolving.value = false }
}

async function send() {
  if (!text.value.trim() || busy.value) return
  busy.value = true; error.value = ''
  try {
    await store.reply(props.thread.id, text.value.trim())
    text.value = ''; replying.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось отправить ответ' }
  finally { busy.value = false }
}
</script>

<style scoped>
.et { margin: 6px 0; padding: 6px 8px; font-size: var(--fs-sm); border: 1px solid var(--border-strong); border-left: 3px solid var(--warning-text); border-radius: var(--radius-sm); background: var(--bg2); }
.et.resolved { opacity: 0.7; border-left-color: var(--border-strong); }
.et-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.et-badge { padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.et-spacer { flex: 1; }
.et-after { margin-top: 6px; }
.et-state { font-size: var(--fs-xs); color: var(--text-muted); }
.et-state.wait { color: var(--warning-text); font-weight: 600; }
.et-state.done { color: var(--accent-hover); }
.et-place { max-width: 100%; margin-top: 4px; }
.et-path { min-width: 0; line-height: var(--lh-normal); overflow-wrap: anywhere; text-align: left; }
.et-muted { font-size: var(--fs-xs); color: var(--text-muted); }
.et-link { padding: 0; font: inherit; font-size: var(--fs-sm); color: var(--blue-hover); background: none; border: none; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
.et-note { margin-top: 6px; }
.et-note-head { display: flex; align-items: center; gap: 8px; }
.et-author { font-weight: 600; }
.et-danger { color: var(--danger-hover); }
.et-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.et-reply { margin-top: 6px; }
.et-reply textarea.control { width: 100%; height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.et-actions { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.et-actions .et-muted { flex: 1; }
.et-error { margin-top: 4px; color: var(--danger-hover); }
</style>
