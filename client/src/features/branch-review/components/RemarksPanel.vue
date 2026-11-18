<template>
  <div class="rp">
    <div v-if="session" class="rp-agent">
      <span class="rp-dot" :class="session.status" />
      <span class="rp-name" :title="session.title">{{ agentName }}</span>
      <span class="rp-muted">{{ statusLabel(session.status) }}</span>
      <span class="rp-spacer" />
      <AppButton v-if="agentBusy" size="xs" variant="ghost" :disabled="stopping" title="Прервать агента; вопросы без ответа вернутся в очередь" @click="stop">{{ stopping ? 'Останавливаю…' : 'Стоп' }}</AppButton>
    </div>
    <div class="rp-actions">
      <AppButton size="xs" variant="ghost" :disabled="composing" title="Замечание не к строке, а ко всему МР: архитектура, подход, разбиение" @click="composing = true; asking = false">+ К МР целиком</AppButton>
      <AppButton size="xs" variant="ghost" :disabled="asking" title="Вопрос агенту не к строке, а ко всей ветке: что изменилось, на что смотреть. Вопрос к строке — выделите её в diff" @click="asking = true; composing = false">+ Вопрос агенту</AppButton>
      <span class="rp-spacer" />
      <template v-if="mr">
        <AppButton size="xs" variant="blue" :disabled="!drafts.length || busy" :title="drafts.length ? 'Опубликовать черновики в GitLab одной пачкой' : 'Нет черновиков'" @click="publish">{{ busy ? 'Публикация…' : 'Опубликовать ' + drafts.length }}</AppButton>
      </template>
      <template v-else>
        <AppButton size="xs" variant="ghost" :disabled="!drafts.length" title="Скопировать черновики как markdown, чтобы вставить их на хостинге" @click="copy">Скопировать {{ drafts.length }}</AppButton>
        <AppButton size="xs" variant="subtle" :disabled="!drafts.length || busy" title="Вы опубликовали их сами: следующий круг начнётся отсюда" @click="markSent">Отправлены</AppButton>
      </template>
    </div>
    <QueueBar :screen-key="screenKey" :scope="scope" :review-id="reviewId" :head="head" />
    <div class="rp-visibility"><AppClosedItemsToggle v-model="visibility.preference.showClosed" :hidden-count="visibility.hiddenCount.value" /></div>
    <p v-if="error" role="alert" class="rp-error">{{ error }}</p>
    <div class="rp-list">
      <form v-if="composing" class="rp-new" @submit.prevent="addGeneral" @keydown.esc.stop.prevent="composing = false">
        <div class="rp-new-head">Замечание к МР целиком</div>
        <AppTextarea v-model="text" block rows="4" placeholder="Текст уйдёт в МР общим комментарием. Ctrl+Enter — сохранить" spellcheck="false" @keydown.ctrl.enter.prevent="addGeneral" @keydown.meta.enter.prevent="addGeneral" />
        <div class="rp-bar">
          <span class="rp-spacer" />
          <AppButton variant="subtle" size="xs" type="button"  @click="composing = false">Отмена</AppButton>
          <AppButton variant="blue" size="xs" type="submit" :disabled="!text.trim()">Сохранить</AppButton>
        </div>
      </form>
      <form v-if="asking" class="rp-new" @submit.prevent="askGeneral" @keydown.esc.stop.prevent="asking = false">
        <div class="rp-new-head">Вопрос агенту по всей ветке</div>
        <AppTextarea v-model="question" block rows="3" placeholder="Например: расскажи в общих чертах, что изменилось и на что обратить внимание. Ctrl+Enter — в очередь" spellcheck="false" @keydown.ctrl.enter.prevent="askGeneral" @keydown.meta.enter.prevent="askGeneral" />
        <div class="rp-bar">
          <span class="rp-spacer" />
          <AppButton variant="subtle" size="xs" type="button" @click="asking = false">Отмена</AppButton>
          <AppButton variant="blue" size="xs" type="submit" :disabled="!question.trim()">В очередь</AppButton>
        </div>
      </form>
      <div v-if="!screen.remarks.length && !questions.length && !closedQuestions.length && !composing && !asking" class="rp-empty">
        Выделите строку в diff и напишите замечание или задайте вопрос агенту, либо начните ревью агентом на вкладке «Обзор». Замечания копятся черновиками{{ mr ? ' и уходят в GitLab только по «Опубликовать»' : '' }}, вопросы — в очереди и уходят агенту по «Отправить агенту».
      </div>
      <template v-for="group in groups" :key="group.title">
        <div class="rp-group">{{ group.title }} <span class="rp-count">{{ group.items.length }}</span></div>
        <RemarkCard v-for="r in group.items" :key="r.id" :remark="r" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :show-location="!!r.path" @goto="emit('goto', $event)" />
      </template>
      <template v-if="questions.length">
        <div class="rp-group">Вопросы агенту <span class="rp-count">{{ questions.length }}</span></div>
        <BranchQuestionCard
          v-for="q in questions" :key="q.id" :question="q" :messages="screen.messages.filter(m => m.question_id === q.id)" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :agent-busy="agentBusy"
          @goto="emit('goto-question', q)" @to-remark="emit('to-remark', q, $event)"
        />
      </template>
      <section v-if="shownRejected.length || shownClosedQuestions.length" class="rp-sent">
        <div class="rp-group">Закрытые {{ shownRejected.length + shownClosedQuestions.length }}</div>
        <AppClosedItemNotice v-for="r in shownRejected" :key="r.id" :notice="visibility.notice('remark:' + r.id, true)" @reveal="visibility.reveal('remark:' + r.id)">
          <RemarkCard :remark="r" :screen-key="screenKey" :scope="scope" :review-id="reviewId" show-location @goto="emit('goto', $event)" />
        </AppClosedItemNotice>
        <AppClosedItemNotice v-for="q in shownClosedQuestions" :key="q.id" :notice="visibility.notice('question:' + q.id, true)" @reveal="visibility.reveal('question:' + q.id)">
        <BranchQuestionCard
          :question="q" :messages="screen.messages.filter(m => m.question_id === q.id)" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :agent-busy="agentBusy"
          @goto="emit('goto-question', q)" @to-remark="emit('to-remark', q, $event)"
        />
        </AppClosedItemNotice>
      </section>
      <details v-if="sent.length" class="rp-sent">
        <summary>Отправленные {{ sent.length }}</summary>
        <RemarkCard v-for="r in sent" :key="r.id" :remark="r" :screen-key="screenKey" :scope="scope" :review-id="reviewId" show-location @goto="emit('goto', $event)" />
      </details>
    </div>
  </div>
</template>
<script setup lang="ts">
import AppTextarea from '@shared/ui/AppTextarea.vue'
import AppClosedItemsToggle from '@shared/ui/AppClosedItemsToggle.vue'
import AppClosedItemNotice from '@shared/ui/AppClosedItemNotice.vue'
import { useRemarkVisibility } from '@core/composables/useRemarkVisibility'
import { useDraft } from '@core/composables/useDraft'
import { computed, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { platform } from '@core/platform'
import AppButton from '@shared/ui/AppButton.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import { statusLabel } from '@features/agent-chat'
import type { BranchQuestion, Remark } from '../types'
import { useReviewAgent } from '../composables/useReviewAgent'
import { plural, remarksMarkdown } from '../utils'
import BranchQuestionCard from './BranchQuestionCard.vue'
import QueueBar from './QueueBar.vue'
import RemarkCard from './RemarkCard.vue'

/** The remarks of the review: drafts grouped by place, published in one batch. */
/** `embedded` tells the questions that live in the card of a remark or a thread: they are not listed here. */
const props = defineProps<{ screenKey: string; scope: string; reviewId: string; head: string; mr: boolean; embedded: (question: BranchQuestion) => boolean }>()
const emit = defineEmits<{ goto: [remark: Remark]; 'goto-question': [question: BranchQuestion]; 'to-remark': [question: BranchQuestion, text: string] }>()
const { screen, session, busy: agentBusy, agentName } = useReviewAgent(props.screenKey, computed(() => props.head))
const app = useAppStore()
const asking = ref(false), stopping = ref(false), question = useDraft(() => `branch-review:${props.reviewId}:remarks:question`, () => '')
// A question the developer has finished goes to the rejected ones, like a rejected remark.
const questions = computed(() => screen.questions.filter(q => !props.embedded(q) && !q.closed))
const closedQuestions = computed(() => screen.questions.filter(q => !props.embedded(q) && q.closed))
const busy = ref(false), error = ref(''), composing = ref(false), text = useDraft(() => `branch-review:${props.reviewId}:remarks:text`, () => '')

// Rejected remarks stay in the review but are never published; they have their own group.
const drafts = computed(() => screen.remarks.filter(r => r.status === 'draft' || r.status === 'uncertain'))
const rejected = computed(() => screen.remarks.filter(r => r.status === 'rejected'))
const sent = computed(() => screen.remarks.filter(r => r.status === 'sent'))
const visibility = useRemarkVisibility(() => `${props.scope}:${props.reviewId}`, () => [
  ...screen.remarks.map(r => ({ id: 'remark:' + r.id, closed: r.status === 'rejected' })),
  ...screen.questions.filter(q => !props.embedded(q)).map(q => ({ id: 'question:' + q.id, closed: q.closed })),
])
const shownRejected = computed(() => rejected.value.filter(r => visibility.visible('remark:' + r.id, true)))
const shownClosedQuestions = computed(() => closedQuestions.value.filter(q => visibility.visible('question:' + q.id, true)))
const groups = computed(() => {
  const general = drafts.value.filter(r => !r.path)
  const files = [...new Set(drafts.value.filter(r => r.path).map(r => r.path))].sort()
  return [
    ...(general.length ? [{ title: 'К МР целиком', items: general }] : []),
    ...files.map(path => ({ title: path, items: drafts.value.filter(r => r.path === path).sort((a, b) => a.line - b.line) })),
  ]
})

async function addGeneral() {
  if (!text.value.trim()) return
  try {
    screen.remarks = (await branchReviewApi.addRemark(props.scope, props.reviewId, { body: text.value })).remarks
    text.value = ''; composing.value = false
  } catch (cause) { error.value = errorText(cause) }
}
/** A question to the agent about the whole branch waits in the queue with the rest. */
async function askGeneral() {
  const written = question.value.trim()
  if (!written) return
  try {
    const result = await branchReviewApi.addQuestion(props.scope, props.reviewId, { text: written })
    screen.questions = result.questions; screen.messages = result.messages
    question.value = ''; asking.value = false
  } catch (cause) { error.value = errorText(cause) }
}
async function stop() {
  stopping.value = true
  try { const result = await branchReviewApi.stop(props.scope, props.reviewId); screen.questions = result.questions; screen.messages = result.messages }
  catch (cause) { error.value = errorText(cause) } finally { stopping.value = false }
}
async function publish() {
  const ready = drafts.value.filter(r => r.status === 'draft')
  if (!ready.length) return
  const agentOnes = ready.filter(r => r.author === 'agent').length
  const message = `Опубликовать ${ready.length} ${plural(ready.length, 'замечание', 'замечания', 'замечаний')} в GitLab от вашего имени?` + (agentOnes ? ` Из них от агента: ${agentOnes} — проверьте, что согласны с ними.` : '')
  if (!(await app.confirm(message, { confirmLabel: 'Опубликовать' }))) return
  busy.value = true; error.value = ''
  try {
    const result = await branchReviewApi.publish(props.scope, props.reviewId, ready.map(r => r.id))
    screen.remarks = result.remarks
    if ('publication_error' in result && result.publication_error) error.value = result.publication_error
    else app.toast('Замечания опубликованы', 'success')
  } catch (cause) { error.value = errorText(cause) } finally { busy.value = false }
}
async function copy() {
  await platform.setClipboardText(remarksMarkdown(drafts.value))
  app.toast('Замечания скопированы', 'success')
}
async function markSent() {
  if (!(await app.confirm('Отметить черновики отправленными? Сделайте это, когда опубликуете их на хостинге.', { confirmLabel: 'Отметить' }))) return
  busy.value = true; error.value = ''
  try { screen.remarks = (await branchReviewApi.markSent(props.scope, props.reviewId, drafts.value.map(r => r.id))).remarks }
  catch (cause) { error.value = errorText(cause) } finally { busy.value = false }
}
</script>
<style scoped>
.rp { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.rp-visibility { flex-shrink: 0; padding: var(--sp-2) var(--sp-3); }
.rp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; flex-shrink: 0; }
.rp-agent { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex-shrink: 0; border-bottom: 1px solid var(--border); }
.rp-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-muted { color: var(--text-muted); }
.rp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: var(--radius-round); background: var(--text-faint); }
.rp-dot.thinking, .rp-dot.starting { background: var(--blue-hover); }
.rp-dot.waiting { background: var(--warning-text); }
.rp-spacer { flex: 1; }
.rp-error { padding: 6px 10px; color: var(--danger-hover); overflow-wrap: anywhere; }
.rp-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
.rp-empty { padding: 8px 2px; color: var(--text-muted); line-height: 1.45; }
.rp-group { margin-top: 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); overflow-wrap: anywhere; }
.rp-count { font-weight: 400; }
.rp-new { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.rp-new-head { font-weight: 600; color: var(--text-muted); }
.rp-bar { display: flex; align-items: center; gap: 6px; }
.rp-sent { margin-top: 8px; }
.rp-sent summary { cursor: pointer; color: var(--text-muted); margin-bottom: 6px; }
.rp-sent > :deep(.rc) { margin-bottom: 6px; }
</style>
