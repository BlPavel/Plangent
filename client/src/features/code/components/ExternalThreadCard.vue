<template>
  <div class="et" :class="{ resolved: thread.resolved }">
    <div class="et-head">
      <span class="et-badge" title="Комментарий из GitLab, не тред с агентом">GitLab</span>
      <span v-if="thread.resolved" class="et-muted">решено</span>
      <button v-if="showLocation && thread.path" type="button" class="et-link" @click="emit('goto')">{{ thread.path }}<template v-if="thread.line">:{{ thread.line }}</template></button>
      <span class="et-spacer" />
      <button v-if="canDiscuss" type="button" class="et-link" title="Создать пункт ревью с этим комментарием и разобрать его с агентом" @click="emit('discuss', thread)">Разобрать с агентом</button>
      <button type="button" class="et-link" :disabled="resolving" :title="thread.resolved ? 'Снова открыть обсуждение в GitLab' : 'Пометить обсуждение решённым в GitLab'" @click="toggleResolved">{{ thread.resolved ? 'Открыть снова' : 'Решено' }}</button>
      <button v-if="!replying" type="button" class="et-link" @click="replying = true">Ответить</button>
    </div>
    <div v-for="note in thread.notes" :key="note.id" class="et-note">
      <div class="et-note-head">
        <span class="et-author">{{ note.author }}</span>
        <template v-if="note.mine && editingId !== note.id">
          <button type="button" class="et-link" :disabled="noteBusy" @click="startEdit(note)">Изменить</button>
          <button type="button" class="et-link et-danger" :disabled="noteBusy" @click="removeNote(note)">Удалить</button>
        </template>
      </div>
      <form v-if="editingId === note.id" class="et-reply" @submit.prevent="saveEdit(note)" @keydown.esc.stop.prevent="editingId = null">
        <textarea v-model="editText" class="control" rows="3" spellcheck="false" @keydown.ctrl.enter.prevent="saveEdit(note)" @keydown.meta.enter.prevent="saveEdit(note)" />
        <div class="et-actions">
          <span class="et-muted">Изменение увидят все участники МР</span>
          <AppButton type="button" size="xs" variant="ghost" @click="editingId = null">Отмена</AppButton>
          <AppButton type="submit" size="xs" variant="blue" :disabled="!editText.trim() || noteBusy">{{ noteBusy ? 'Сохранение…' : 'Сохранить в GitLab' }}</AppButton>
        </div>
        <div v-if="error" class="et-error">{{ error }}</div>
      </form>
      <div v-else class="et-body">{{ note.body }}</div>
    </div>
    <div v-if="error && !replying && editingId === null" class="et-error">{{ error }}</div>
    <form v-if="replying" class="et-reply" @submit.prevent="send" @keydown.esc.stop.prevent="replying = false">
      <textarea v-model="text" class="control" rows="3" placeholder="Ответ уйдёт в обсуждение GitLab. Ctrl+Enter — отправить" spellcheck="false" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send" />
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
import { ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useExternalThreadsStore } from '../stores/external'
import type { ExternalNote, ExternalThread } from '../types'

const props = defineProps<{ thread: ExternalThread; showLocation?: boolean; canDiscuss?: boolean }>()
const emit = defineEmits<{ goto: []; discuss: [thread: ExternalThread] }>()
const store = useExternalThreadsStore()
const app = useAppStore()
const replying = ref(false), text = ref(''), busy = ref(false), error = ref(''), resolving = ref(false)

const editingId = ref<number | null>(null), editText = ref(''), noteBusy = ref(false)

function startEdit(note: ExternalNote) { editingId.value = note.id; editText.value = note.body; error.value = '' }
async function saveEdit(note: ExternalNote) {
  if (!editText.value.trim() || noteBusy.value) return
  noteBusy.value = true; error.value = ''
  try { await store.editNote(props.thread.id, note.id, editText.value.trim()); editingId.value = null }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось изменить комментарий' }
  finally { noteBusy.value = false }
}
async function removeNote(note: ExternalNote) {
  if (!(await app.confirm('Удалить комментарий в GitLab? Это нельзя отменить.', { confirmLabel: 'Удалить' }))) return
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
.et { margin: 6px 0; padding: 6px 8px; font-size: 12px; border: 1px solid var(--border-strong); border-left: 3px solid var(--warning-text); border-radius: var(--radius-sm); background: var(--bg2); }
.et.resolved { opacity: 0.7; border-left-color: var(--border-strong); }
.et-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.et-badge { padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.et-spacer { flex: 1; }
.et-muted { font-size: 11px; color: var(--text-muted); }
.et-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
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
