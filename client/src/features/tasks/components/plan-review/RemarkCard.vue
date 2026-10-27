<template>
  <article class="remark" :class="{ selected, rejected: remark.status === 'rejected' }">
    <header>
      <strong>{{ number }} · {{ kinds[remark.kind] }}</strong>
      <button type="button" class="link" title="Подсветить эти шаги в плане" @click="$emit('highlight', remark.steps.filter(s => !s.deleted).map(s => s.id))">
        {{ remark.steps.length ? remark.steps.map(s => s.id + (s.deleted ? ' (удалён)' : '')).join(', ') : 'Весь план' }}
      </button>
    </header>
    <details :open="!['rejected', 'applied'].includes(remark.status)">
      <summary>{{ statuses[remark.status] }}<span v-if="remark.outdated" title="План изменился после ревью. Проверьте, актуально ли замечание"> · к прежней редакции плана</span></summary>
      <MessageMarkdown :text="remark.text" />
      <MessageMarkdown v-if="remark.suggestion" :text="'Предложение: ' + remark.suggestion" />
      <div v-for="message in remark.messages" :key="message.id" class="message">
        <small>{{ authors[message.author] }}{{ message.author === 'developer' && !message.sent ? ' · ещё не отправлено' : '' }}</small>
        <MessageMarkdown :text="body(message).text" />
      </div>
      <p v-if="remark.status === 'sent' && planner" class="note" :class="{ attention: planner === 'waiting' || planner === 'idle' || planner === 'missing' }">
        {{ plannerNotes[planner] }}
        <button v-if="planner !== 'missing'" type="button" class="link" @click="$emit('open-planner')">Открыть чат планировщика</button>
      </p>
      <template v-if="!readonly">
        <div v-if="!['sent', 'applied'].includes(remark.status)" class="actions">
          <AppButton size="sm" variant="ghost" :disabled="busy" title="Согласен: планировщик исправит план. Можно добавить уточнение" @click="mode = 'accepted'">Принять</AppButton>
          <AppButton size="sm" variant="ghost" :disabled="busy" title="Есть вопрос или сомнение: планировщик ответит в карточке и не будет менять план по ней сам" @click="mode = 'discussing'">Обсудить</AppButton>
          <AppButton size="sm" variant="ghost" :disabled="busy" title="Не согласен: карточка не уйдёт планировщику" @click="mode = 'rejected'">Отклонить</AppButton>
          <AppButton v-if="remark.status !== 'open'" size="sm" variant="ghost" :disabled="busy" title="Снять решение и вернуть карточку в «Без решения»" @click="$emit('decision', 'open', '')">Вернуть</AppButton>
        </div>
        <div v-else class="actions">
          <AppButton size="sm" variant="ghost" :disabled="busy" title="Возразить или задать вопрос: карточка уйдёт планировщику следующей пачкой" @click="mode = 'discussing'">Обсудить</AppButton>
          <AppButton size="sm" variant="ghost" :disabled="busy" title="Снять отправку и вернуть карточку в «Без решения»" @click="$emit('decision', 'open', '')">Вернуть</AppButton>
        </div>
        <form v-if="mode" @submit.prevent="submit">
          <label>{{ mode === 'accepted' ? 'Уточнение для планировщика (необязательно)' : mode === 'rejected' ? 'Причина отклонения (необязательно, ревьюер увидит её в следующем раунде)' : 'Вопрос или комментарий для планировщика' }}
            <textarea v-model="draft" class="control" rows="3" :disabled="busy" />
          </label>
          <div class="actions">
            <AppButton size="sm" :disabled="busy || (mode === 'discussing' && !draft.trim())" type="submit">Сохранить</AppButton>
            <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="mode = null">Отмена</AppButton>
          </div>
        </form>
      </template>
    </details>
  </article>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import type { Remark } from '../../plan-review/types'
defineProps<{ remark: Remark; number: number; readonly: boolean; busy: boolean; selected: boolean; planner?: 'working' | 'waiting' | 'idle' | 'missing' | '' }>()
const emit = defineEmits<{ highlight: [ids: string[]]; decision: [status: Remark['status'], comment: string]; 'open-planner': [] }>()
const mode = ref<'accepted' | 'discussing' | 'rejected' | null>(null), draft = ref('')
const kinds = { contradiction: 'Противоречие', order: 'Порядок', coverage: 'Покрытие', extra: 'Лишнее', unclear: 'Неясность', risk: 'Риск' }
const statuses = { open: 'Без решения', accepted: 'Принято', discussing: 'Обсуждение', rejected: 'Отклонено', sent: 'Отправлено планировщику', applied: 'Учтено в плане', answered: 'Планировщик ответил' }
const authors = { developer: 'Вы', reviewer: 'Ревьюер', planner: 'Планировщик' }
const plannerNotes = {
  working: 'Планировщик работает над карточкой. Ответ появится здесь.',
  waiting: 'Планировщик ждёт вашего ответа в своём чате.',
  idle: 'Планировщик закончил, но не отметил карточку ни учтённой, ни отвеченной. Загляните в его чат или верните карточку.',
  missing: 'Чат планировщика удалён, ответа уже не будет.',
}
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
header, .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
summary { cursor: pointer; color: var(--text-muted); margin: 8px 0; }
.link { color: var(--blue-hover); background: none; border: 0; cursor: pointer; }
.message { border-left: 2px solid var(--border); margin: 10px 0; padding-left: 10px; }
.note { margin: 8px 0; color: var(--text-muted); }
.note.attention { color: var(--warning-text); }
small { color: var(--text-muted); }
label { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
textarea { width: 100%; resize: vertical; }
</style>
