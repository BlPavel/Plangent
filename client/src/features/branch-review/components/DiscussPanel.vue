<template>
  <div class="dp" aria-label="Вопросы агенту">
    <div class="dp-agent">
      <template v-if="session">
        <span class="dp-dot" :class="session.status" />
        <span class="dp-name" :title="session.title">{{ agentName }}</span>
        <span class="muted">{{ statusLabel(session.status) }}</span>
        <span class="dp-spacer" />
        <AppButton v-if="busy" size="xs" variant="ghost" :disabled="stopping" title="Прервать агента; вопросы без ответа вернутся в очередь" @click="stop">{{ stopping ? 'Останавливаю…' : 'Стоп' }}</AppButton>
      </template>
      <span v-else class="muted">Агент только читает код и отвечает в карточках</span>
    </div>

    <div class="dp-actions">
      <AppButton size="xs" variant="ghost" :disabled="composing" title="Вопрос не к строке, а ко всей ветке: что изменилось, на что смотреть" @click="composing = true">+ Общий</AppButton>
      <AppButton
        size="xs" variant="blue" :disabled="!pending || busy || sending"
        :title="busy ? 'Агент отвечает: дождитесь конца ответа' : pending ? 'Отправить агенту новые вопросы и ваши ответы в обсуждениях' : 'Нечего отправлять'"
        @click="send(null)"
      >{{ sending ? 'Отправка…' : `Отправить${pending ? ' ' + pending : ''}` }}</AppButton>
    </div>
    <p v-if="error" role="alert" class="dp-error">{{ error }}</p>

    <div class="dp-list">
      <form v-if="composing" class="dp-new" @submit.prevent="addGeneral">
        <div class="dp-new-head">Общий вопрос по ветке</div>
        <textarea v-model="generalText" class="control dp-text" rows="3" placeholder="Например: расскажи в общих чертах, что изменилось и на что обратить внимание. Ctrl+Enter — сохранить" spellcheck="false" @keydown.ctrl.enter.prevent="addGeneral" @keydown.meta.enter.prevent="addGeneral" />
        <div class="dp-new-bar">
          <button type="button" class="btn btn-subtle btn-xs" @click="composing = false">Отмена</button>
          <button class="btn btn-blue btn-xs" :disabled="!generalText.trim()">Сохранить</button>
        </div>
      </form>
      <div v-if="!screen.questions.length && !composing" class="dp-empty">
        Выделите строку в diff и задайте вопрос или добавьте общий. Вопросы копятся, агенту ничего не уходит, пока вы не нажмёте «Отправить».
        Ответ агента можно сразу превратить в замечание.
      </div>
      <BranchQuestionCard
        v-for="q in screen.questions" :key="q.id" :question="q" :messages="thread(q.id)" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :agent-busy="busy"
        @goto="emit('goto', q)" @send-now="send([q.id])" @to-remark="emit('to-remark', q, $event)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { statusLabel } from '@features/agent-chat'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchQuestion } from '../types'
import { useReviewAgent } from '../composables/useReviewAgent'
import BranchQuestionCard from './BranchQuestionCard.vue'

const props = defineProps<{ screenKey: string; scope: string; reviewId: string; head: string }>()
const emit = defineEmits<{ goto: [question: BranchQuestion]; 'to-remark': [question: BranchQuestion, text: string] }>()
const { screen, session, busy, agentName } = useReviewAgent(props.screenKey, computed(() => props.head))
const sending = ref(false), stopping = ref(false), error = ref(''), composing = ref(false), generalText = ref('')

const queuedIds = computed(() => new Set(screen.messages.filter(m => m.author === 'developer' && !m.sent).map(m => m.question_id)))
const pending = computed(() => queuedIds.value.size)
const thread = (id: string) => screen.messages.filter(m => m.question_id === id)

/** The agent is the project's review agent (project settings); a new conversation starts by itself when the branch has changed. */
async function send(ids: string[] | null) {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    const result = await branchReviewApi.send(props.scope, props.reviewId, ids ? { question_ids: ids } : {})
    screen.questions = result.questions; screen.messages = result.messages; screen.thread = result.thread
  } catch (cause) { error.value = errorText(cause) } finally { sending.value = false }
}
async function stop() {
  stopping.value = true
  try { const result = await branchReviewApi.stop(props.scope, props.reviewId); screen.questions = result.questions; screen.messages = result.messages }
  catch (cause) { error.value = errorText(cause) } finally { stopping.value = false }
}
async function addGeneral() {
  const text = generalText.value.trim()
  if (!text) return
  try {
    const result = await branchReviewApi.addQuestion(props.scope, props.reviewId, { text })
    screen.questions = result.questions; screen.messages = result.messages
    generalText.value = ''; composing.value = false
  } catch (cause) { error.value = errorText(cause) }
}
</script>
<style scoped>
.dp { flex: 1; display: flex; flex-direction: column; min-height: 0; font-size: 12px; }
.dp-agent, .dp-actions { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex-shrink: 0; }
.dp-agent { border-bottom: 1px solid var(--border); }
.dp-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--text-faint); }
.dp-dot.thinking, .dp-dot.starting { background: var(--blue-hover); }
.dp-dot.waiting { background: var(--warning-text); }
.dp-spacer { flex: 1; }
.dp-error { padding: 6px 10px; color: var(--danger-hover); overflow-wrap: anywhere; }
.dp-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; }
.dp-empty { padding: 8px 2px; color: var(--text-muted); line-height: 1.45; }
.dp-new { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.dp-new-head { font-weight: 600; color: var(--text-muted); }
.dp-text { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.dp-new-bar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
