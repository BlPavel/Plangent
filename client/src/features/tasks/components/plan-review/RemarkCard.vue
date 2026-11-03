<template>
  <article class="remark" :class="{ selected, rejected: remark.status === 'rejected' }">
    <header>
      <strong>{{ number }} · {{ remarkKinds[remark.kind] }}</strong>
      <button type="button" class="link" :title="L.highlight" @click="$emit('highlight', remark.steps.filter(s => !s.deleted).map(s => s.id))">
        {{ remark.steps.length ? remark.steps.map(s => s.id + (s.deleted ? ' (удалён)' : '')).join(', ') : remark.quote ? 'Цитата' : L.whole }}
      </button>
    </header>
    <blockquote v-if="remark.quote" class="quote">{{ remark.quote }}</blockquote>
    <details :open="!['accepted', 'rejected', 'applied'].includes(remark.status)">
      <summary>
        <span class="badge" :class="['st-' + remark.status, { live }]">{{ statuses[remark.status] }}</span>
        <span v-if="hint" class="hint">{{ hint }}</span>
      </summary>
      <form v-if="editing" class="edit" @submit.prevent="saveEdit">
        <label>Замечание<textarea v-model="editText" class="control" rows="5" :disabled="busy" /></label>
        <label>Предложение (необязательно)<textarea v-model="editSuggestion" class="control" rows="3" :disabled="busy" /></label>
        <div class="actions form-actions">
          <AppButton size="sm" variant="blue" :disabled="busy || !editText.trim()" type="submit">Сохранить текст</AppButton>
          <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="editing = false">Отмена</AppButton>
        </div>
      </form>
      <template v-else>
        <MessageMarkdown :text="remark.text" />
        <MessageMarkdown v-if="remark.suggestion" :text="'Предложение: ' + remark.suggestion" />
      </template>
      <details v-if="remark.original" class="was">
        <summary>Текст изменён после обсуждения · посмотреть, что было</summary>
        <MessageMarkdown :text="remark.original.text" />
        <MessageMarkdown v-if="remark.original.suggestion" :text="'Предложение: ' + remark.original.suggestion" />
      </details>
      <div v-for="message in remark.messages" :key="message.id" class="message">
        <small>{{ authors[message.author] }}{{ message.author === 'developer' && !message.sent ? ' · ещё не отправлено' : '' }}</small>
        <MessageMarkdown :text="body(message).text" />
      </div>
      <p v-if="remark.status === 'sent' && planner" class="note" :class="{ attention: planner === 'waiting' || planner === 'idle' || planner === 'missing' }">
        {{ plannerNotes[planner] }}
        <button v-if="planner !== 'missing'" type="button" class="link" @click="$emit('open-planner')">Открыть {{ L.recipientChat }}</button>
      </p>
      <template v-if="!readonly">
        <div v-if="!['sent', 'applied', 'accepted', 'rejected'].includes(remark.status)" class="actions">
          <AppButton size="sm" variant="primary" :disabled="busy" :title="`Согласен: ${L.recipientNom.toLowerCase()} исправит ${L.subject}. Можно добавить уточнение`" @click="mode = 'accepted'">Принять</AppButton>
          <AppButton size="sm" variant="blue" :disabled="busy" :title="`Есть вопрос или сомнение: ревьюер ответит в карточке, ${L.subject} по ней не изменится`" @click="mode = 'discussing'">Обсудить</AppButton>
          <AppButton size="sm" variant="danger-ghost" :disabled="busy" :title="`Не согласен: карточка не уйдёт ${L.recipient}`" @click="reject">Отклонить</AppButton>
          <AppButton size="sm" variant="subtle" :disabled="busy" :title="`Переписать замечание самому: ${L.recipient} получит именно этот текст`" @click="startEdit">Править текст</AppButton>
        </div>
        <div v-else class="actions">
          <AppButton size="sm" variant="subtle" :disabled="busy" :title="remark.status === 'sent' || remark.status === 'applied' ? 'Снять отправку и вернуть карточку в «Без решения»' : 'Снять решение и вернуть карточку в «Без решения»'" @click="$emit('decision', 'open', '')">Вернуть</AppButton>
        </div>
        <form v-if="mode" @submit.prevent="submit">
          <label>{{ mode === 'accepted' ? `Уточнение для ${L.recipientGen} (необязательно)` : 'Вопрос или возражение ревьюеру' }}
            <textarea v-model="draft" class="control" rows="3" :disabled="busy" />
          </label>
          <div class="actions form-actions">
            <AppButton size="sm" :variant="mode === 'accepted' ? 'primary' : 'blue'" :disabled="busy || (mode === 'discussing' && !draft.trim())" type="submit">{{ mode === 'accepted' ? 'Принять' : 'Добавить в обсуждение' }}</AppButton>
            <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="mode = null">Отмена</AppButton>
          </div>
        </form>
      </template>
    </details>
  </article>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import type { Remark, ReviewTarget } from '../../plan-review/types'
import { remarkKinds, reviewLabels } from '../../plan-review/labels'
const props = withDefaults(defineProps<{ remark: Remark; target?: ReviewTarget; number: number; readonly: boolean; busy: boolean; selected: boolean; planner?: 'working' | 'waiting' | 'idle' | 'missing' | ''; reviewerWorking?: boolean }>(), { target: 'plan' })
const L = computed(() => reviewLabels[props.target])
const emit = defineEmits<{ highlight: [ids: string[]]; decision: [status: Remark['status'], comment: string]; 'open-planner': []; edit: [text: string, suggestion: string] }>()
const mode = ref<'accepted' | 'discussing' | null>(null), draft = ref('')
const editing = ref(false), editText = ref(''), editSuggestion = ref('')
function startEdit() { editText.value = props.remark.text; editSuggestion.value = props.remark.suggestion; mode.value = null; editing.value = true }
function saveEdit() { emit('edit', editText.value, editSuggestion.value); editing.value = false }
// Rejecting needs no reason: the card is just closed.
function reject() { mode.value = null; draft.value = ''; emit('decision', 'rejected', '') }
const hints = computed<Partial<Record<Remark['status'], string>>>(() => ({
  accepted: `Уйдёт ${L.value.recipient}, когда решите по всем карточкам и нажмёте «Отправить ${L.value.recipient}»`,
  rejected: `Не уйдёт ${L.value.recipient}`,
  sent: `${L.value.recipientNom} работает над ней`,
  answered: `${L.value.recipientNom} ответил: прочитайте и решите дальше`,
  applied: props.target === 'plan' ? 'План исправлен' : 'Документ исправлен',
}))
// The agent that holds the card is working on it right now.
const live = computed(() => props.remark.status === 'sent' ? props.planner === 'working'
  : props.remark.status === 'discussing' && !!props.reviewerWorking && props.remark.messages.at(-1)?.author === 'developer' && props.remark.messages.every(m => m.author !== 'developer' || m.sent))
// A card under discussion is between you and the reviewer; it does not go to the planner until accepted.
const hint = computed(() => props.remark.status === 'discussing'
  ? props.remark.messages.some(m => m.author === 'developer' && !m.sent) ? 'Ждёт отправки: нажмите «Отправить ревьюеру» вверху'
    : props.reviewerWorking && props.remark.messages.at(-1)?.author === 'developer' ? 'Ревьюер отвечает…' : 'Обсуждение с ревьюером: примите или отклоните карточку'
  : hints.value[props.remark.status])
const statuses = computed(() => ({ open: 'Без решения', accepted: 'Принято', discussing: 'Обсуждение', rejected: 'Отклонено', sent: 'Отправлено ' + L.value.recipient,
  applied: 'Учтено ' + L.value.subjectIn, answered: L.value.recipientNom + ' ответил' }))
const authors = computed(() => ({ developer: 'Вы', reviewer: 'Ревьюер', planner: L.value.recipientNom }))
const plannerNotes = computed(() => ({
  working: `${L.value.recipientNom} работает над карточкой. Ответ появится здесь.`,
  waiting: `${L.value.recipientNom} ждёт вашего ответа в своём чате.`,
  idle: `${L.value.recipientNom} закончил, но не отметил карточку ни учтённой, ни отвеченной. Загляните в его чат или верните карточку.`,
  missing: `Чат (${L.value.recipientNom.toLowerCase()}) удалён, ответа уже не будет.`,
}))
// The planner's reply carries its kind as a prefix ("disagree: …"); show it as a label instead of raw protocol text.
const replyKinds: Record<string, string> = { answer: 'Ответ', options: 'Варианты', questions: 'Вопросы', change: 'Что изменено', disagree: 'Не согласен' }
function body(message: Remark['messages'][number]) {
  const match = message.author === 'planner' ? /^(answer|options|questions|change|disagree): ([\s\S]*)$/.exec(message.text) : null
  return match ? { text: `**${replyKinds[match[1]]}.** ${match[2]}` } : { text: message.text }
}
function submit() {
  if (mode.value) emit('decision', mode.value, draft.value)
  mode.value = null; draft.value = ''
}
</script>
<style scoped>
.remark { padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow-wrap: anywhere; }
.remark.selected { border-color: var(--blue); }
.remark.rejected { opacity: 0.75; }
header, .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.actions { margin-top: 14px; }
.form-actions { margin-top: 10px; }
summary { cursor: pointer; margin: 10px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.quote { margin: 8px 0; padding: 4px 10px; border-left: 2px solid var(--border-strong); color: var(--text-muted); font-size: 12px; }
.was { margin: 8px 0; font-size: 12px; color: var(--text-muted); }
.was summary { margin: 0; }
.was > :not(summary) { padding-left: 10px; border-left: 2px solid var(--border); }
.hint { color: var(--text-muted); font-size: 12px; }
.badge { padding: 2px 9px; border-radius: var(--radius-pill); font-size: 11.5px; font-weight: 600; background: var(--bg3); color: var(--text-muted); border: 1px solid var(--border-strong); }
.st-accepted, .st-applied { background: var(--accent-soft); color: var(--accent-hover); border-color: transparent; }
.st-discussing, .st-sent { background: var(--blue-soft); color: var(--blue-hover); border-color: transparent; }
.st-answered { background: var(--warning); color: #0d1117; border-color: transparent; }
.badge.live { animation: badge-pulse 1.2s ease-in-out infinite; }
@keyframes badge-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.st-rejected { background: var(--danger-soft); color: var(--danger-hover); border-color: transparent; }
.link { color: var(--blue-hover); background: none; border: 0; cursor: pointer; }
.message { border-left: 2px solid var(--border); margin: 10px 0; padding-left: 10px; }
.note { margin: 8px 0; color: var(--text-muted); }
.note.attention { color: var(--warning-text); }
small { color: var(--text-muted); }
label { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
textarea { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; }
</style>
