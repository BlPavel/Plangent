<template>
  <section class="interview" :class="{ answered: !!sent, closed: closed && !sent }" :aria-label="`Интервью, раунд ${round.round} из ${round.total_rounds}`" data-interview-round>
    <header class="head">
      <div class="head-line">
        <span class="label">Интервью</span>
        <span class="round">Раунд {{ round.round }} из {{ round.total_rounds }}</span>
        <span class="progress" aria-hidden="true">
          <i v-for="n in round.total_rounds" :key="n" :class="{ past: n < round.round || n === round.round && !!sent, current: n === round.round && !sent }" />
        </span>
        <AppBadge v-if="sent && finished" tone="done">Интервью завершено</AppBadge>
        <AppBadge v-else-if="sent" tone="done">Ответы отправлены</AppBadge>
        <AppBadge v-else-if="closed">Без ответа</AppBadge>
      </div>
      <div v-if="round.topic" class="topic">{{ round.topic }}</div>
    </header>

    <ol class="questions">
      <li v-for="(question, i) in round.questions" :key="question.id" class="question" :data-question="question.id">
        <div class="q-head">
          <span class="q-num" :class="{ done: answerable && valid(question) }">{{ i + 1 }}</span>
          <div class="q-main">
            <div v-if="clarified && question.id in clarified" class="q-clarified">
              <AppBadge tone="warning">После уточнения</AppBadge>
              <span v-if="clarified[question.id]" class="q-asked">Вы спрашивали: {{ clarified[question.id] }}</span>
            </div>
            <div class="q-text">{{ question.text }}</div>
            <div v-if="question.context" class="q-context">{{ question.context }}</div>
          </div>
        </div>
        <div v-if="answerable" class="q-answer">
          <AppChoiceList :model-value="draft.picks[question.id] ?? null" :options="choices(question)" :label="question.text" @update:model-value="draft.picks[question.id] = $event" />
          <AppTextarea
            v-if="draft.picks[question.id] === 'custom' || draft.picks[question.id] === 'clarify'"
            v-model="draft.texts[question.id]"
            class="q-text-input"
            size="sm" block autosize
            :aria-label="draft.picks[question.id] === 'custom' ? 'Свой ответ' : 'Что непонятно'"
            :placeholder="draft.picks[question.id] === 'custom' ? 'Ваш вариант ответа' : 'Что именно непонятно? Можно оставить пустым — агент переформулирует вопрос'"
            @keydown.ctrl.enter.prevent="send()"
          />
        </div>
        <div v-else-if="answerOf(question)" class="q-answer result" :class="answerOf(question)!.kind">
          <span class="result-label">{{ answerOf(question)!.label }}</span>
          <span class="result-text">{{ answerOf(question)!.text }}</span>
          <AppBadge v-if="answerOf(question)!.recommended" tone="done">рекомендованный</AppBadge>
        </div>
        <div v-else-if="sent" class="q-answer result open"><span class="result-label">Остался открытым</span></div>
      </li>
    </ol>

    <footer v-if="answerable" class="foot">
      <span class="count">Отвечено {{ answered }} из {{ round.questions.length }}</span>
      <span class="foot-actions">
        <AppButton variant="subtle" size="sm" :disabled="sending" title="Отправить данные ответы и закончить интервью: агент подведёт итог, выполнит просьбу и оставит остальные вопросы открытыми" @click="send(true)">Завершить интервью</AppButton>
        <AppButton v-if="canAcceptRecommended" variant="subtle" size="sm" title="Выбрать рекомендованный вариант в вопросах без ответа" @click="acceptRecommended">Принять рекомендации</AppButton>
        <AppButton variant="primary" size="sm" :disabled="!complete || sending" title="Ctrl+Enter в поле ответа" @click="send()">{{ sending ? 'Отправляем…' : 'Отправить ответы' }}</AppButton>
      </span>
    </footer>
    <div v-if="round.upcoming?.length && !sent && !closed" class="next">Дальше: {{ round.upcoming.join(' · ') }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InterviewAnswer, InterviewQuestion } from '@contracts'
import { AppBadge, AppButton, AppChoiceList, AppTextarea } from '@shared/ui'
import { useDraft } from '@core/composables/useDraft'
import { useDraftsStore } from '@core/stores/drafts'
import type { InterviewRound } from '../utils/interview'

// `sent`: answers already in the conversation; `finished`: they ended the interview early. `closed`: a later round
// replaced this one, it can no longer be answered. `clarified`: questions asked again after a clarification request.
const props = defineProps<{ sessionId: string; seq: number; round: InterviewRound; sent?: InterviewAnswer[] | null; finished?: boolean; closed?: boolean; clarified?: Record<string, string>; submit: (answers: InterviewAnswer[], finish: boolean) => Promise<boolean> }>()
const drafts = useDraftsStore()
const draftKey = () => `session:${props.sessionId}:interview:${props.seq}`
const draft = useDraft(draftKey, () => ({ picks: {} as Record<string, string>, texts: {} as Record<string, string> }))
const sending = ref(false)
const answerable = computed(() => !props.sent && !props.closed)

function choices(question: InterviewQuestion) {
  return [
    ...question.options.map((option, i) => ({ value: 'o' + i, label: option.label, hint: option.detail, badge: option.recommended ? 'Рекомендую' : undefined })),
    { value: 'custom', label: 'Свой вариант…', secondary: true },
    { value: 'clarify', label: 'Не понимаю вопрос — уточнить', secondary: true },
  ]
}
function answer(question: InterviewQuestion): InterviewAnswer | null {
  const pick = draft.value.picks[question.id], text = (draft.value.texts[question.id] ?? '').trim()
  if (pick === 'custom') return text ? { question_id: question.id, kind: 'custom', text } : null
  if (pick === 'clarify') return { question_id: question.id, kind: 'clarify', text }
  if (pick?.startsWith('o')) return { question_id: question.id, kind: 'option', index: Number(pick.slice(1)) }
  return null
}
const valid = (question: InterviewQuestion) => !!answer(question)
const answered = computed(() => props.round.questions.filter(valid).length)
const complete = computed(() => answered.value === props.round.questions.length)
const canAcceptRecommended = computed(() => props.round.questions.some(q => !draft.value.picks[q.id] && q.options.some(o => o.recommended)))
function acceptRecommended() {
  for (const question of props.round.questions) {
    const index = question.options.findIndex(o => o.recommended)
    if (!draft.value.picks[question.id] && index >= 0) draft.value.picks[question.id] = 'o' + index
  }
}
async function send(finish = false) {
  if (!finish && !complete.value || sending.value) return
  sending.value = true
  try { if (await props.submit(props.round.questions.flatMap(q => answer(q) ?? []), finish)) drafts.clear(draftKey()) }
  finally { sending.value = false }
}

function answerOf(question: InterviewQuestion) {
  const sent = props.sent?.find(a => a.question_id === question.id)
  if (!sent) return null
  if (sent.kind === 'option') {
    const option = question.options[sent.index]
    return { kind: 'option', label: 'Выбрано', text: option?.label ?? '—', recommended: !!option?.recommended }
  }
  if (sent.kind === 'custom') return { kind: 'custom', label: 'Свой ответ', text: sent.text, recommended: false }
  return { kind: 'clarify', label: 'Нужно уточнить', text: sent.text || 'вопрос непонятен', recommended: false }
}
</script>

<style scoped>
.interview { display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-4); background: var(--bg2); border: 1px solid var(--blue-outline-soft); border-radius: var(--radius-lg); box-shadow: 0 0 0 3px var(--blue-soft); }
.interview.answered, .interview.closed { gap: var(--sp-3); border-color: var(--border); box-shadow: none; }
.interview.closed { opacity: .7; }

.head { display: flex; flex-direction: column; gap: var(--sp-1); }
.head-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.label { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--blue-hover); }
.round { font-size: var(--fs-sm); color: var(--text-muted); }
.progress { display: inline-flex; gap: 3px; margin-right: auto; }
.progress i { width: 16px; height: 4px; border-radius: var(--radius-pill); background: var(--bg3); }
.progress i.past { background: var(--accent-hover); }
.progress i.current { background: var(--blue-hover); }
.topic { font-size: var(--fs-lg); font-weight: var(--fw-semibold); line-height: var(--lh-heading); }

.questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-5); }
.answered .questions, .closed .questions { gap: var(--sp-3); }
.question { display: flex; flex-direction: column; gap: var(--sp-2); }
.q-head { display: flex; align-items: flex-start; gap: var(--sp-3); }
.q-num { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-round); background: var(--bg3); color: var(--text-muted); font-size: var(--fs-sm); font-weight: var(--fw-semibold); transition: background var(--motion-fast), color var(--motion-fast); }
.q-num.done { background: var(--accent-soft); color: var(--accent-hover); }
.q-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 1px; }
.q-clarified { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: 2px; }
.q-asked { font-size: var(--fs-sm); color: var(--text-muted); overflow-wrap: anywhere; }
.q-text { font-size: var(--fs-base); font-weight: var(--fw-medium); line-height: var(--lh-normal); overflow-wrap: anywhere; }
.q-context { font-size: var(--fs-md); color: var(--text-muted); line-height: var(--lh-normal); overflow-wrap: anywhere; }
.q-answer { display: flex; flex-direction: column; gap: var(--sp-2); padding-left: 34px; }
.q-text-input { margin-top: 2px; }

.result { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: var(--sp-2); font-size: var(--fs-md); }
.result-label { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent-hover); }
.result.custom .result-label { color: var(--blue-hover); }
.result.clarify .result-label { color: var(--warning-text); }
.result.open .result-label { color: var(--text-faint); }
.result-text { white-space: pre-wrap; overflow-wrap: anywhere; }

.foot { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-3); border-top: 1px solid var(--border); }
.count { font-size: var(--fs-sm); color: var(--text-muted); margin-right: auto; }
.foot-actions { display: flex; gap: var(--sp-2); }
.next { font-size: var(--fs-sm); color: var(--text-faint); overflow-wrap: anywhere; margin-top: calc(var(--sp-2) * -1); }
</style>
