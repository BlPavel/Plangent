<template>
  <aside class="review-panel">
    <header class="toolbar">
      <strong>Ревью плана</strong>
      <span class="spacer" />
      <AppButton v-if="canLaunch && state.reviews.value.length" size="sm" variant="ghost" :class="{ on: setupOpen }" :disabled="phase === 'running'" :title="phase === 'running' ? 'Ревьюер ещё работает' : 'Настроить и запустить новый раунд ревью'" @click="setupOpen = !setupOpen">Новый раунд</AppButton>
      <AppButton size="sm" variant="ghost" icon title="Скрыть панель ревью" aria-label="Скрыть панель ревью" @click="$emit('close')">✕</AppButton>
    </header>
    <p v-if="locked" class="muted">План заморожен на время выполнения очереди.</p>
    <section v-if="canLaunch && setupOpen" class="setup">
      <div class="setup-grid">
        <span class="setup-label">Агент</span>
        <AgentPicker :key="setupKey" v-model="choice" :default-agent-id="defaultAgentId" />
        <span class="setup-label">Пожелание</span>
        <textarea v-model="wish" class="control wish" rows="4" placeholder="Необязательно: на что обратить внимание, что не проверять" spellcheck="false" />
      </div>
      <p v-if="unfinishedText" class="warn">{{ unfinishedText }}</p>
      <div class="setup-actions">
        <AppButton size="sm" variant="blue" :disabled="state.busy.value || phase === 'running' || !choice.agent_id" @click="launch">{{ state.reviews.value.length ? 'Запустить новый раунд' : 'Запустить ревью' }}</AppButton>
      </div>
    </section>
    <div v-if="state.error.value" class="error-box" role="alert">
      <span>{{ state.error.value }}</span>
      <AppButton size="xs" variant="ghost" @click="state.refresh">Повторить загрузку</AppButton>
    </div>
    <template v-if="detail">
      <label v-if="state.reviews.value.length > 1">Раунд
        <PlainSelect v-model="state.selected.value" :options="state.reviews.value.map((r, i) => ({ value: r.id, label: 'Раунд ' + r.round + (i === 0 ? ' · последний' : '') }))" label="Раунд ревью" />
      </label>
      <p class="phase" :class="'phase-' + phase" role="status"><span class="phase-dot" />{{ reviewerName }} · {{ phaseText }}</p>
      <p v-if="phase === 'stalled' || phase === 'failed'" role="status" class="warn">{{ stalledText }}</p>
      <p v-if="!isLatest" class="warn">Это не последний раунд: решения здесь уже не уходят планировщику. Вернитесь к последнему раунду.</p>
      <p v-if="summaryLine" class="counts">{{ summaryLine }}</p>
      <p v-if="nextStep" class="next" role="status">{{ nextStep }}</p>
      <h3>Сводка</h3>
      <MessageMarkdown v-if="detail.review.overview" :text="detail.review.overview" />
      <p v-else class="muted">Сводка появится после ответа ревьюера.</p>
      <h3>Покрытие материалов</h3>
      <p class="muted">Как план выглядел на момент ревью: {{ detail.review.coverage.length ? 'что из требований покрыто шагами.' : 'ревьюер ещё не сохранил таблицу.' }}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Статус</th><th>Требование</th><th>Шаги</th><th>Замечание</th></tr></thead>
          <tbody><tr v-for="(row, index) in detail.review.coverage" :key="index">
            <td :title="coverageLabels[row.status]" :aria-label="coverageLabels[row.status]">{{ coverageIcons[row.status] }}</td><td>{{ row.requirement }}</td>
            <td>{{ row.steps.join(', ') || '—' }}</td>
            <td><button v-if="row.remark_id" type="button" class="link" @click="focusCard(row.remark_id)">→ замечание {{ cardNumber(row.remark_id) }}</button></td>
          </tr></tbody>
        </table>
      </div>
      <p v-if="detail.review.coverage.length" class="muted">Таблица — справка: здесь ничего не нажимается. Решения принимаются в карточках ниже.</p>
      <header class="toolbar">
        <h3>Замечания ({{ detail.remarks.length }})</h3>
        <div class="toolbar-actions">
          <AppButton v-if="!readonly && countOf('discussing')" size="sm" :variant="askCount ? 'blue' : 'ghost'" :disabled="locked || state.busy.value || !askCount || reviewerWorking || !isLatest" :title="askCount ? (reviewerWorking ? 'Ревьюер ещё отвечает: дождитесь конца хода' : 'Ваши сообщения в обсуждаемых карточках уйдут ревьюеру одной пачкой') : 'Нажмите «Обсудить» в карточке и напишите ревьюеру'" @click="ask">
            Отправить ревьюеру{{ askCount ? ` (${askCount})` : '' }}
          </AppButton>
          <AppButton v-if="!readonly" size="sm" :variant="canSend ? 'blue' : 'ghost'" :disabled="locked || state.busy.value || !canSend || !isLatest" :title="sendHint" @click="send">
            Отправить планировщику ({{ acceptedCount }})
          </AppButton>
        </div>
      </header>
      <p v-if="activityText" class="activity" role="status"><span class="phase-dot" />{{ activityText }}</p>
      <p v-else-if="reportChat" class="report-link" role="status">Планировщик вносил изменения. Отчёт о том, что и как исправлено, он пишет в своём чате, там же можно задать вопрос или попросить поправить.
        <button type="button" class="link" @click="$emit('openPlanner', reportChat)">Открыть чат планировщика</button></p>
      <RemarkCard
        v-for="(remark, index) in detail.remarks" :key="remark.id" :ref="el => setCard(remark.id, el)"
        :remark="remark" :number="index + 1" :readonly="readonly || locked" :busy="state.busy.value" :selected="focused === remark.id" :planner="plannerState(remark)" :reviewer-working="reviewerWorking"
        @highlight="$emit('highlight', $event)" @open-planner="remark.planner_session_id && $emit('openPlanner', remark.planner_session_id)" @edit="(text, suggestion) => state.run(() => api.edit(projectId, taskId, detail!.review.id, remark.id, text, suggestion))"
        @decision="(status, comment) => state.run(() => api.decision(projectId, taskId, detail!.review.id, remark.id, status, comment))"
      />
    </template>
    <p v-if="detail && !detail.remarks.length" class="muted">{{ phase === 'running' ? 'Замечаний пока нет: ревьюер ещё работает.' : 'Ревьюер не нашёл замечаний.' }}</p>
  </aside>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch, type ComponentPublicInstance } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import { planReviewApi as api } from '../../plan-review/api'
import { usePlanReview } from '../../plan-review/usePlanReview'
import type { Launch, Remark } from '../../plan-review/types'
import AgentPicker from './AgentPicker.vue'
import RemarkCard from './RemarkCard.vue'
const props = defineProps<{ projectId: string; taskId: string; defaultAgentId?: string | null; locked: boolean; readonly: boolean }>()
const emit = defineEmits<{ highlight: [ids: string[]]; counts: [counts: Record<string, number>]; attention: [count: number]; close: []; openPlanner: [sessionId: string] }>()
const state = usePlanReview(toRef(props, 'projectId'), toRef(props, 'taskId'))
const detail = state.detail, agents = useAgentsStore(), chats = useChatStore()
watch(state.counts, counts => emit('counts', counts), { immediate: true })
const wish = ref('')
const choice = ref<Launch>({ agent_id: '' })
const acceptedCount = computed(() => detail.value?.remarks.filter(r => r.status === 'accepted').length || 0)
const countOf = (status: string) => detail.value?.remarks.filter(r => r.status === status).length || 0
// Cards that wait for the developer: no decision yet, being discussed with the reviewer, or the planner has answered.
const undecided = computed(() => countOf('open') + countOf('discussing') + countOf('answered'))
watch(undecided, n => emit('attention', props.readonly ? 0 : n), { immediate: true })
// Comments under «Обсудить» pile up in their cards and leave for the reviewer in one batch, like replies in the code review.
// What is happening right now, next to the buttons that started it: sending, the reviewer answering, the planner fixing the plan.
const sending = ref('')
const plannerWorking = computed(() => detail.value?.remarks.some(r => plannerState(r) === 'working') ?? false)
const activityText = computed(() => sending.value
  || (plannerWorking.value ? 'Планировщик исправляет план по принятым карточкам…' : '')
  || (reviewerWorking.value && phase.value === 'done' ? 'Ревьюер отвечает в карточках…' : ''))
// The planner's report is written in its chat; the panel points there once cards have gone to it.
const reportChat = computed(() => detail.value?.remarks.filter(r => ['sent', 'applied', 'answered'].includes(r.status) && r.planner_session_id).at(-1)?.planner_session_id || '')
const askCount = computed(() => detail.value?.remarks.filter(r => r.status === 'discussing' && r.messages.some(m => m.author === 'developer' && !m.sent)).length || 0)
async function ask() {
  if (props.locked || props.readonly || !askCount.value) return
  sending.value = 'Отправляю сообщения ревьюеру…'
  try { await state.run(() => api.discuss(props.projectId, props.taskId, detail.value!.review.id)) } finally { sending.value = '' }
}
// The planner gets the accepted cards once every card has a decision.
const canSend = computed(() => !!acceptedCount.value && !undecided.value)
const sendHint = computed(() => undecided.value ? `Сначала решите по всем карточкам: осталось ${undecided.value}` : acceptedCount.value ? 'Принятые карточки уйдут планировщику: он исправит план' : 'Принятых карточек нет')
const isLatest = computed(() => !detail.value || detail.value.review.id === state.reviews.value[0]?.id)
// The reviewer is live while its chat works. An «open» review whose chat has stopped will never be completed by itself.
const reviewerChat = computed(() => chats.sessions.find(s => s.id === detail.value?.review.session_id))
const reviewerDown = computed(() => detail.value?.review.status === 'open' && !['starting', 'thinking', 'waiting'].includes(reviewerChat.value?.status || ''))
const stalled = ref(false)
let stalledTimer: ReturnType<typeof setTimeout> | undefined
// A fresh review's chat may not be in the store yet: it counts as stalled only if it stays so.
watch(reviewerDown, down => { clearTimeout(stalledTimer); if (down) stalledTimer = setTimeout(() => { stalled.value = true }, 4000); else stalled.value = false }, { immediate: true })
onBeforeUnmount(() => clearTimeout(stalledTimer))
const phase = computed(() => {
  const status = detail.value?.review.status
  return !status ? 'none' : status === 'failed' ? 'failed' : status === 'completed' ? 'done' : stalled.value && reviewerDown.value ? 'stalled' : 'running'
})
// Cards under discussion wait for the reviewer's chat to answer.
const reviewerWorking = computed(() => ['starting', 'thinking', 'waiting'].includes(reviewerChat.value?.status || ''))
const phaseText = computed(() => ({ none: '', running: 'Ревью выполняется…', stalled: 'Ревьюер остановился', failed: 'Ревью не удалось', done: 'Ревью завершено' })[phase.value])
const stalledText = computed(() => {
  const why = reviewerChat.value?.status === 'error' ? 'Агент завершился с ошибкой' + (reviewerChat.value.reason ? ': ' + reviewerChat.value.reason : '') + '. ' : ''
  return phase.value === 'failed'
    ? why + 'Ревьюер не запустился. Проверьте агента в настройках и запустите ревью ещё раз.'
    : why + 'Ревьюер остановился, не сохранив итог (приложение закрывали или агент прервался). Готовые карточки можно разобрать, а ревью запустить ещё раз.'
})
const summaryLine = computed(() => {
  const parts: [string, number][] = [['Без решения', countOf('open')], ['Принято', countOf('accepted')], ['С ревьюером', countOf('discussing')],
    ['Отправлено', countOf('sent')], ['Планировщик ответил', countOf('answered')], ['Учтено в плане', countOf('applied')], ['Отклонено', countOf('rejected')]]
  return parts.filter(([, n]) => n).map(([label, n]) => label + ' ' + n).join(' · ')
})
// One line telling what to do next, from the state of the cards.
const nextStep = computed(() => {
  if (!detail.value || !detail.value.remarks.length || props.readonly) return ''
  if (props.locked) return 'Очередь выполняется. Решения можно будет принимать, когда она закончится или будет остановлена.'
  if (countOf('answered')) return 'Планировщик ответил. Прочитайте ответы и решите по карточкам: принять, отклонить или обсудить с ревьюером.'
  if (askCount.value) return 'Ваши сообщения ждут отправки. Нажмите «Отправить ревьюеру»: он ответит в карточках.'
  if (countOf('discussing')) return 'Есть карточки в обсуждении с ревьюером. Когда он ответит, примите или отклоните их — тогда планировщику можно будет отправить принятые.'
  if (countOf('open')) return 'Решите по каждой карточке: «Принять» — исправить план, «Обсудить» — спросить ревьюера, «Отклонить» — не согласен.'
  if (acceptedCount.value) return 'По всем карточкам есть решения. Нажмите «Отправить планировщику»: он исправит план по принятым.'
  if (countOf('sent')) return 'Планировщик работает над отправленными карточками. Ответы и правки появятся здесь.'
  return 'Все замечания разобраны. Можно запускать очередь на вкладке «Выполнение» или проверить план ещё раз.'
})
const unfinishedText = computed(() => {
  if (!detail.value || !isLatest.value) return ''
  const parts = [undecided.value && 'без решения: ' + undecided.value, acceptedCount.value && 'не отправлено планировщику: ' + acceptedCount.value].filter(Boolean)
  return parts.length ? 'В текущем раунде осталось ' + parts.join(', ') + '. Новый раунд откроется отдельно: ревьюер увидит ваши решения как историю, но планировщику они не уйдут.' : ''
})
function plannerState(remark: Remark) {
  if (remark.status !== 'sent' || !remark.planner_session_id) return ''
  const chat = chats.sessions.find(s => s.id === remark.planner_session_id)
  return !chat ? 'missing' : chat.status === 'waiting' ? 'waiting' : ['starting', 'thinking'].includes(chat.status) ? 'working' : 'idle'
}
const reviewerName = computed(() => {
  const session = chats.sessions.find(s => s.id === detail.value?.review.session_id)
  return agents.agents.find(a => a.id === session?.agent_id)?.name || 'Ревьюер'
})
const coverageIcons = { covered: '✅', missing: '❌', partial: '⚠' }
const coverageLabels = { covered: 'Покрыто', missing: 'Не покрыто', partial: 'Частично' }
function focusStep(id: string) {
  const remark = detail.value?.remarks.find(r => r.status === 'open' && r.steps.some(s => !s.deleted && s.id === id))
  if (remark) focusCard(remark.id)
}
defineExpose({ focusStep })
const focused = ref(''), cards = new Map<string, Element>()
function setCard(id: string, el: Element | ComponentPublicInstance | null) {
  if (el) cards.set(id, '$el' in el ? el.$el : el)
  else cards.delete(id)
}
function cardNumber(id: string) { return (detail.value?.remarks.findIndex(r => r.id === id) ?? -1) + 1 }
function focusCard(id: string) {
  focused.value = id; cards.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  const remark = detail.value?.remarks.find(r => r.id === id)
  if (remark) emit('highlight', remark.steps.filter(s => !s.deleted).map(s => s.id))
}
// The settings sit in the panel, open until the first review exists and then behind «Новый раунд».
// They start from the previous round's agent. What to check comes from the review instruction (Settings, project «Инструкции»).
const setupReady = ref(false), setupKey = ref(0), setupOpen = ref(true)
const canLaunch = computed(() => !props.readonly && !props.locked && setupReady.value)
watch(() => state.reviews.value.length, (n, old) => { if (!old && n) setupOpen.value = false }, { immediate: true })
function loadSetup() {
  const session = chats.sessions.find(s => s.id === state.reviews.value[0]?.session_id)
  choice.value = session ? { agent_id: session.agent_id, model: session.model, reasoning_effort: String(session.metadata.reasoningEffort || '') } : { agent_id: props.defaultAgentId || '' }
  setupKey.value++; setupReady.value = true
}
watch(() => [props.projectId, props.taskId, state.reviews.value[0]?.id], loadSetup, { immediate: true })
async function launch() {
  if (props.locked || props.readonly || !choice.value.agent_id) return
  if (await state.run(() => api.launch(props.projectId, props.taskId, { ...choice.value, wish: wish.value }))) { wish.value = ''; setupOpen.value = false }
}
// No dialog: the planner that wrote the plan continues if it is free, otherwise a new one starts with the default agent.
async function send() {
  if (!detail.value || props.locked || props.readonly || state.busy.value || !canSend.value) return
  sending.value = 'Отправляю карточки планировщику…'
  try { await state.run(() => api.send(props.projectId, props.taskId, detail.value!.review.id, props.defaultAgentId ? { agent_id: props.defaultAgentId } : {})) } finally { sending.value = '' }
}
watch(() => [props.projectId, props.taskId], () => { focused.value = ''; emit('highlight', []) })
watch(state.selected, () => { focused.value = ''; emit('highlight', []) })
</script>
<style scoped>
.review-panel { flex: 0 0 44%; min-width: 0; overflow-y: auto; padding: 16px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
h3, p { margin: 0; } h3 { font-size: 13px; }
.muted { color: var(--text-muted); }
.warn { color: var(--warning-text); }
.counts { color: var(--text-muted); font-size: 12px; }
.next { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg2); }
.spacer { flex: 1; }
.error-box { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger-hover); }
.activity { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 600; background: rgba(210, 153, 34, 0.15); color: var(--warning-text); }
.activity .phase-dot { animation: phase-pulse 1.2s ease-in-out infinite; }
.report-link { padding: 8px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-hover); }
.report-link .link { margin-left: 4px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.phase { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 600; background: var(--bg3); color: var(--text-muted); }
.phase-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.phase-running { background: rgba(210, 153, 34, 0.15); color: var(--warning-text); }
.phase-running .phase-dot { animation: phase-pulse 1.2s ease-in-out infinite; }
.phase-done { background: var(--accent-soft); color: var(--accent-hover); }
.phase-failed, .phase-stalled { background: var(--danger-soft); color: var(--danger-hover); }
@keyframes phase-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.toolbar .on { background: var(--bg-hover); }
.setup { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); flex-shrink: 0; }
.setup-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 12px; }
.setup-label:last-of-type { align-self: start; padding-top: 8px; }
.wish { min-height: 80px; padding: 8px 10px; line-height: 1.45; resize: vertical; }
.setup-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.setup-controls { display: flex; align-items: center; gap: 6px; min-width: 0; }
.setup-actions { display: flex; justify-content: flex-end; }
.table-wrap { overflow-x: auto; flex-shrink: 0; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
td, th { padding: 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.link { border: 0; background: none; color: var(--blue-hover); cursor: pointer; }
label { display: flex; flex-direction: column; gap: 6px; } textarea { width: 100%; resize: vertical; }
@media (max-width: 900px) { .review-panel { flex-basis: 50%; } }
</style>


