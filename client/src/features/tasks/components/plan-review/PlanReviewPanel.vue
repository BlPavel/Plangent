<template>
  <aside class="review-panel">
    <header class="toolbar">
      <strong>Ревью плана</strong>
      <AppButton v-if="!readonly" size="sm" :disabled="locked || state.busy.value || phase === 'running'" :title="locked ? 'План заморожен на время выполнения очереди' : phase === 'running' ? 'Ревьюер ещё работает' : 'Агент прочитает план и материалы анализа, ничего не меняя, и оставит замечания карточками'" @click="openLaunch">
        {{ state.reviews.value.length ? 'Ревью ещё раз' : 'Ревью плана' }}
      </AppButton>
      <AppButton size="sm" variant="ghost" icon title="Скрыть панель ревью" aria-label="Скрыть панель ревью" @click="$emit('close')">✕</AppButton>
    </header>
    <p v-if="locked" class="muted">План заморожен на время выполнения очереди.</p>
    <p v-if="state.error.value" role="alert">{{ state.error.value }} <button type="button" @click="state.refresh">Повторить загрузку</button></p>
    <template v-if="detail">
      <label v-if="state.reviews.value.length > 1">Раунд
        <PlainSelect v-model="state.selected.value" :options="state.reviews.value.map((r, i) => ({ value: r.id, label: 'Раунд ' + r.round + (i === 0 ? ' · последний' : '') }))" label="Раунд ревью" />
      </label>
      <p class="muted">{{ reviewerName }} · {{ phaseText }}</p>
      <p v-if="phase === 'stalled' || phase === 'failed'" role="status" class="warn">{{ stalledText }}</p>
      <p v-if="!isLatest" class="warn">Это не последний раунд: решения здесь уже не уходят планировщику. Вернитесь к последнему раунду.</p>
      <p v-if="summaryLine" class="counts">{{ summaryLine }}</p>
      <p v-if="nextStep" class="next" role="status">{{ nextStep }}</p>
      <p v-if="staleCount" class="warn">К прежней редакции плана относятся замечания: {{ staleCount }}. План уже менялся после ревью. Проверьте, актуальны ли они, или запустите ревью ещё раз.</p>
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
        <AppButton v-if="!readonly" size="sm" :disabled="locked || state.busy.value || !readyCount || !isLatest" :title="readyCount ? 'Принятые уйдут на исправление плана, обсуждаемые — на ответ в карточке' : 'Сначала примите или обсудите хотя бы одну карточку'" @click="openSend">
          Отправить планировщику ({{ readyCount }})
        </AppButton>
      </header>
      <RemarkCard
        v-for="(remark, index) in detail.remarks" :key="remark.id" :ref="el => setCard(remark.id, el)"
        :remark="remark" :number="index + 1" :readonly="readonly || locked" :busy="state.busy.value" :selected="focused === remark.id" :planner="plannerState(remark)"
        @highlight="$emit('highlight', $event)" @open-planner="remark.planner_session_id && $emit('openPlanner', remark.planner_session_id)"
        @decision="(status, comment) => state.run(() => api.decision(projectId, taskId, detail!.review.id, remark.id, status, comment))"
      />
    </template>
    <p v-if="detail && !detail.remarks.length" class="muted">{{ phase === 'running' ? 'Замечаний пока нет: ревьюер ещё работает.' : 'Ревьюер не нашёл замечаний.' }}</p>
    <div v-else-if="!detail" class="empty">
      <p class="muted">Ревью проверит, что шаги не противоречат друг другу и материалам анализа, порядок исполним, а план покрывает требования.</p>
      <p class="muted">Агент только читает. Решения по замечаниям принимаете вы, план меняет планировщик.</p>
    </div>
    <AppModal v-model="launchOpen" title="Ревью плана" confirm-label="Запустить ревью" @confirm="launch">
      <p class="muted">Ревьюер только читает план и материалы анализа и оставляет замечания карточками. План он не меняет.</p>
      <p v-if="unfinishedText" class="warn">{{ unfinishedText }}</p>
      <AgentPicker v-if="launchOpen" v-model="choice" :default-agent-id="defaultAgentId" />
      <label>Скилл ревью плана
        <PlainSelect v-model="skill" :options="skills.length ? skills.map(s => ({ value: s.id, label: s.title + ' · ' + origins[s.origin] })) : [{ value: '', label: 'Встроенный' }]" label="Скилл ревью плана" />
      </label>
      <label>Пожелание (необязательно)<textarea v-model="wish" class="control" rows="3" placeholder="На что обратить внимание, что не проверять" /></label>
      <p v-if="state.error.value" role="alert">{{ state.error.value }}</p>
    </AppModal>
    <AppModal v-model="sendOpen" title="Отправить планировщику" confirm-label="Отправить" @confirm="send">
      <label>Планировщик
        <PlainSelect v-model="planner" :options="plannerOptions" label="Планировщик" />
      </label>
      <AgentPicker v-if="sendOpen && !planner" v-model="plannerChoice" :default-agent-id="defaultAgentId" />
      <p v-if="!planner && planners.sessions.length" class="muted">{{ planners.sessions.some(s => s.busy) ? 'Часть планировщиков сейчас отвечает: выберите нового или дождитесь их. ' : '' }}Новый планировщик начнёт с чистого чата: он получит план и карточки.</p>
      <ul class="send-list">
        <li>Принятых: {{ acceptedCount }}. Планировщик исправит по ним план.</li>
        <li>На обсуждение: {{ discussionCount }}. Планировщик ответит в карточках, план по ним не меняет.</li>
        <li v-if="notSentCount" class="muted">Не уйдёт: {{ notSentCount }} (без решения или отклонено).</li>
      </ul>
      <p class="muted">Пока планировщик работает, план лучше не править вручную: его правка может перекрыть вашу.</p>
      <p v-if="state.error.value" role="alert">{{ state.error.value }}</p>
    </AppModal>
  </aside>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch, type ComponentPublicInstance } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import { errorText } from '@shared/utils/errorText'
import { planReviewApi as api } from '../../plan-review/api'
import { usePlanReview } from '../../plan-review/usePlanReview'
import type { Launch, Skill, Planners, Remark } from '../../plan-review/types'
import AgentPicker from './AgentPicker.vue'
import RemarkCard from './RemarkCard.vue'
const props = defineProps<{ projectId: string; taskId: string; defaultAgentId?: string | null; locked: boolean; readonly: boolean }>()
const emit = defineEmits<{ highlight: [ids: string[]]; counts: [counts: Record<string, number>]; attention: [count: number]; close: []; openPlanner: [sessionId: string] }>()
const state = usePlanReview(toRef(props, 'projectId'), toRef(props, 'taskId'))
const detail = state.detail, agents = useAgentsStore(), chats = useChatStore()
watch(state.counts, counts => emit('counts', counts), { immediate: true })
const launchOpen = ref(false), sendOpen = ref(false), wish = ref(''), skill = ref(''), skills = ref<Skill[]>([])
const choice = ref<Launch>({ agent_id: '' }), plannerChoice = ref<Launch>({ agent_id: '' })
const planner = ref(''), planners = ref<Planners>({ sessions: [], default_session_id: null })
const acceptedCount = computed(() => detail.value?.remarks.filter(r => r.status === 'accepted').length || 0)
const discussionCount = computed(() => detail.value?.remarks.filter(r => r.status === 'discussing').length || 0)
const readyCount = computed(() => acceptedCount.value + discussionCount.value)
const countOf = (status: string) => detail.value?.remarks.filter(r => r.status === status).length || 0
// Cards that wait for the developer: no decision yet, or the planner has answered.
watch(() => countOf('open') + countOf('answered'), n => emit('attention', props.readonly ? 0 : n), { immediate: true })
const notSentCount = computed(() => countOf('open') + countOf('rejected'))
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
const phaseText = computed(() => ({ none: '', running: 'Ревью выполняется…', stalled: 'Ревьюер остановился', failed: 'Ревью не удалось', done: 'Ревью завершено' })[phase.value])
const stalledText = computed(() => {
  const why = reviewerChat.value?.status === 'error' ? 'Агент завершился с ошибкой' + (reviewerChat.value.reason ? ': ' + reviewerChat.value.reason : '') + '. ' : ''
  return phase.value === 'failed'
    ? why + 'Ревьюер не запустился. Проверьте агента в настройках и запустите ревью ещё раз.'
    : why + 'Ревьюер остановился, не сохранив итог (приложение закрывали или агент прервался). Готовые карточки можно разобрать, а ревью запустить ещё раз.'
})
const staleCount = computed(() => detail.value?.remarks.filter(r => r.outdated && ['open', 'accepted', 'discussing'].includes(r.status)).length || 0)
const summaryLine = computed(() => {
  const parts: [string, number][] = [['Без решения', countOf('open')], ['Принято', countOf('accepted')], ['Обсуждается', countOf('discussing')],
    ['Отправлено', countOf('sent')], ['Планировщик ответил', countOf('answered')], ['Учтено в плане', countOf('applied')], ['Отклонено', countOf('rejected')]]
  return parts.filter(([, n]) => n).map(([label, n]) => label + ' ' + n).join(' · ')
})
// One line telling what to do next, from the state of the cards.
const nextStep = computed(() => {
  if (!detail.value || !detail.value.remarks.length || props.readonly) return ''
  if (props.locked) return 'Очередь выполняется. Решения можно будет принимать, когда она закончится или будет остановлена.'
  if (countOf('answered')) return 'Планировщик ответил. Прочитайте ответы и решите по карточкам: принять, продолжить обсуждение или отклонить.'
  if (countOf('open')) return 'Разберите замечания: «Принять» — исправить план, «Обсудить» — спросить планировщика, «Отклонить» — не согласен.'
  if (readyCount.value) return 'Решения приняты. Нажмите «Отправить планировщику», чтобы он исправил план и ответил на вопросы.'
  if (countOf('sent')) return 'Планировщик работает над отправленными карточками. Ответы и правки появятся здесь.'
  return 'Все замечания разобраны. Можно запускать очередь на вкладке «Выполнение» или проверить план ещё раз.'
})
const unfinishedText = computed(() => {
  if (!detail.value || !isLatest.value) return ''
  const parts = [countOf('open') && 'без решения: ' + countOf('open'), readyCount.value && 'не отправлено планировщику: ' + readyCount.value].filter(Boolean)
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
const plannerOptions = computed(() => [{ value: '', label: 'Новый планировщик' }, ...planners.value.sessions.map(s => ({
  value: s.id, label: s.title + (s.available ? '' : s.busy ? ' · отвечает, подождите' : ' · недоступен'), disabled: !s.available,
}))])
const origins = { direct: 'проект', group: 'группа', global: 'глобально' }
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
async function openLaunch() {
  if (props.locked || props.readonly || state.busy.value) return
  state.error.value = ''
  const p = props.projectId, t = props.taskId
  try {
    const value = await api.skills(p, t)
    if (p !== props.projectId || t !== props.taskId) return
    skills.value = value
    const previous = state.reviews.value[0]
    const session = chats.sessions.find(s => s.id === previous?.session_id)
    choice.value = session ? { agent_id: session.agent_id, model: session.model, reasoning_effort: String(session.metadata.reasoningEffort || '') } : { agent_id: props.defaultAgentId || '' }
    skill.value = value.find(s => s.id === previous?.skill_id)?.id || value[0]?.id || ''
    launchOpen.value = true
  } catch (cause) { state.error.value = errorText(cause) }
}
async function launch() {
  if (props.locked || props.readonly || !choice.value.agent_id) return
  if (await state.run(() => api.launch(props.projectId, props.taskId, { ...choice.value, ...(skill.value ? { skill_id: skill.value } : {}), wish: wish.value }))) launchOpen.value = false
}
async function openSend() {
  if (!detail.value || props.locked || props.readonly || state.busy.value) return
  const p = props.projectId, t = props.taskId, id = detail.value.review.id
  try {
    const value = await api.planners(p, t, id)
    if (p !== props.projectId || t !== props.taskId || detail.value?.review.id !== id) return
    planners.value = value; planner.value = value.default_session_id || ''; sendOpen.value = true
    plannerChoice.value = { agent_id: props.defaultAgentId || '' }
  } catch (cause) { state.error.value = errorText(cause) }
}
async function send() {
  if (!detail.value || props.locked || props.readonly || !readyCount.value) return
  if (!planner.value && !plannerChoice.value.agent_id) return
  if (planner.value && !planners.value.sessions.find(s => s.id === planner.value)?.available) return
  if (await state.run(() => api.send(props.projectId, props.taskId, detail.value!.review.id, { ...plannerChoice.value, session_id: planner.value || null }))) sendOpen.value = false
}
watch(() => [props.projectId, props.taskId], () => { launchOpen.value = false; sendOpen.value = false; focused.value = ''; emit('highlight', []) })
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
.send-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.empty { display: flex; flex-direction: column; gap: 8px; }
.table-wrap { overflow-x: auto; flex-shrink: 0; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
td, th { padding: 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.link { border: 0; background: none; color: var(--blue-hover); cursor: pointer; }
label { display: flex; flex-direction: column; gap: 6px; } textarea { width: 100%; resize: vertical; }
@media (max-width: 900px) { .review-panel { flex-basis: 50%; } }
</style>


