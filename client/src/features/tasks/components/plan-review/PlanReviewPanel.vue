<template>
  <aside class="review-panel">
    <header class="toolbar">
      <strong>{{ L.title }}</strong>
      <span class="spacer" />
      <AppButton v-if="canLaunch && state.reviews.value.length" size="sm" variant="ghost" :pressed="setupOpen" :disabled="phase === 'running'" :title="phase === 'running' ? 'Ревьюер ещё работает' : 'Настроить и запустить новый раунд ревью'" @click="setupOpen = !setupOpen">Новый раунд</AppButton>
      <AppButton size="sm" variant="ghost" icon title="Скрыть панель ревью" aria-label="Скрыть панель ревью" @click="$emit('close')">✕</AppButton>
    </header>
    <p v-if="locked" class="muted">{{ L.frozen }}</p>
    <section v-if="canLaunch && setupOpen" class="setup">
      <div class="setup-grid">
        <span class="setup-label">Агент</span>
        <AgentPicker :key="setupKey" v-model="choice" :default-agent-id="defaultAgentId" />
        <span class="setup-label">Скилл</span>
        <AppSelect v-if="skills.length" v-model="skill" :options="skills.map(s => ({ value: s.id, label: s.title + ' · ' + origins[s.origin] }))" :label="L.skill" :popup-max-width="220" size="sm" />
        <span v-else class="muted">Нет скиллов проекта: только общие проверки из настроек</span>
        <span class="setup-label">Пожелание</span>
        <div class="wish">
          <ChatComposer ref="wishField" field :project-id="projectId" :workspace-id="workspaceId" :draft-key="`task:${taskId}:review:${target}:wish`" placeholder="Необязательно: на что обратить внимание, что не проверять.  @ — файл проекта" @error="state.error.value = $event" />
        </div>
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
        <AppSelect v-model="state.selected.value" :options="state.reviews.value.map((r, i) => ({ value: r.id, label: 'Раунд ' + r.round + (i === 0 ? ' · последний' : '') }))" label="Раунд ревью" :popup-max-width="220" size="sm" />
      </label>
      <p class="phase" :class="'phase-' + phase" role="status"><span class="phase-dot" />{{ reviewerName }} · {{ phaseText }}</p>
      <p v-if="phase === 'stalled' || phase === 'failed'" role="status" class="warn">{{ stalledText }}</p>
      <p v-if="!isLatest" class="warn">Это не последний раунд: решения здесь уже не уходят {{ L.recipient }}. Вернитесь к последнему раунду.</p>
      <p v-if="summaryLine" class="counts">{{ summaryLine }}</p>
      <p v-if="nextStep" class="next" role="status">{{ nextStep }}</p>
      <h3>Сводка</h3>
      <MessageMarkdown v-if="detail.review.overview" :text="detail.review.overview" />
      <p v-else class="muted">Сводка появится после ответа ревьюера.</p>
      <template v-if="target === 'plan'">
        <h3>Покрытие материалов</h3>
        <p class="muted">Как план выглядел на момент ревью: {{ detail.review.coverage.length ? 'что из требований покрыто шагами.' : 'ревьюер ещё не сохранил таблицу.' }}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Статус</th><th>Источник</th><th>Требование</th><th>Шаги</th><th>Замечание</th></tr></thead>
            <tbody><tr v-for="(row, index) in detail.review.coverage" :key="index">
              <td :title="coverageLabels[row.status]" :aria-label="coverageLabels[row.status]">{{ coverageIcons[row.status] }}</td><td>{{ row.criterion ? 'QA ' + row.criterion : 'Анализ' }}</td><td>{{ row.requirement }}</td>
              <td>{{ row.steps.join(', ') || '—' }}</td>
              <td><AppButton variant="link" size="md" v-if="row.remark_id" type="button"  @click="focusCard(row.remark_id)">→ замечание {{ cardNumber(row.remark_id) }}</AppButton></td>
            </tr></tbody>
          </table>
        </div>
        <p v-if="detail.review.coverage.length" class="muted">Таблица — справка: здесь ничего не нажимается. Решения принимаются в карточках ниже.</p>
      </template>
      <header class="toolbar">
        <h3>Замечания ({{ detail.remarks.length }})</h3>
        <div class="toolbar-actions">
          <AppButton v-if="!readonly && countOf('discussing')" size="sm" :variant="askCount ? 'blue' : 'ghost'" :disabled="locked || state.busy.value || !askCount || reviewerWorking || !isLatest" :title="askCount ? (reviewerWorking ? 'Ревьюер ещё отвечает: дождитесь конца хода' : 'Ваши сообщения в обсуждаемых карточках уйдут ревьюеру одной пачкой') : 'Нажмите «Обсудить» в карточке и напишите ревьюеру'" @click="ask">
            Отправить ревьюеру{{ askCount ? ` (${askCount})` : '' }}
          </AppButton>
          <AppButton v-if="!readonly" size="sm" :variant="canSend ? 'blue' : 'ghost'" :disabled="locked || state.busy.value || !canSend || !isLatest" :title="sendHint" @click="openSend">
            Отправить {{ L.recipient }} ({{ acceptedCount }})
          </AppButton>
        </div>
      </header>
      <p v-if="activityText" class="activity" role="status"><span class="phase-dot" />{{ activityText }}</p>
      <p v-else-if="reportChat" class="report-link" role="status">{{ L.recipientNom }} вносил изменения. Отчёт о том, что и как исправлено, он пишет в своём чате, там же можно задать вопрос или попросить поправить.
        <AppButton variant="link" size="md" type="button"  @click="$emit('openPlanner', reportChat)">Открыть {{ L.recipientChat }}</AppButton></p>
      <RemarkCard :task-id="taskId"
        v-for="remark in activeRemarks" :key="remark.id" :ref="el => setCard(remark.id, el)"
        :remark="remark" :target="target" :number="cardNumber(remark.id)" :readonly="readonly || locked" :busy="state.busy.value" :selected="focused === remark.id" :planner="plannerState(remark)" :reviewer-working="reviewerWorking"
        @highlight="$emit('highlight', $event)" @open-planner="remark.planner_session_id && $emit('openPlanner', remark.planner_session_id)" @edit="(text, suggestion) => state.run(() => api.edit(projectId, taskId, detail!.review.id, remark.id, text, suggestion))"
        @decision="(status, comment) => state.run(() => api.decision(projectId, taskId, detail!.review.id, remark.id, status, comment))"
      />
      <details v-if="appliedRemarks.length" :key="`${projectId}:${taskId}:${target}:${detail.review.id}`" ref="appliedSection" class="applied-remarks">
        <summary>Учтено ({{ appliedRemarks.length }})</summary>
        <div class="applied-cards">
          <RemarkCard :task-id="taskId"
            v-for="remark in appliedRemarks" :key="remark.id" :ref="el => setCard(remark.id, el)"
            :remark="remark" :target="target" :number="cardNumber(remark.id)" :readonly="readonly || locked" :busy="state.busy.value" :selected="focused === remark.id" :planner="plannerState(remark)" :reviewer-working="reviewerWorking"
            @highlight="$emit('highlight', $event)" @open-planner="remark.planner_session_id && $emit('openPlanner', remark.planner_session_id)" @edit="(text, suggestion) => state.run(() => api.edit(projectId, taskId, detail!.review.id, remark.id, text, suggestion))"
            @decision="(status, comment) => state.run(() => api.decision(projectId, taskId, detail!.review.id, remark.id, status, comment))"
          />
        </div>
      </details>
    </template>
    <p v-if="detail && !detail.remarks.length" class="muted">{{ phase === 'running' ? 'Замечаний пока нет: ревьюер ещё работает.' : 'Ревьюер не нашёл замечаний.' }}</p>
    <AppModal v-model="sendOpen" size="small" :title="'Отправить ' + L.recipient" confirm-label="Отправить" @confirm="send">
      <p class="muted">Принятых карточек: {{ acceptedCount }}. {{ L.recipientNom }} исправит {{ L.subject }}.</p>
      <AppSelect v-model="recipient" :options="recipientOptions" label="Кому отправить принятые карточки" block :popup-max-width="360" />
      <AgentPicker v-if="sendOpen && recipient === NEW_RECIPIENT" v-model="authorChoice" :default-agent-id="defaultAgentId" />
    </AppModal>
  </aside>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, toRef, watch, type ComponentPublicInstance } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore, ChatComposer } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppModal from '@shared/ui/AppModal.vue'
import { MessageMarkdown } from '@shared/markdown'
import { planReviewApi as api } from '../../plan-review/api'
import { usePlanReview } from '../../plan-review/usePlanReview'
import type { Launch, Remark, ReviewTarget, Skill } from '../../plan-review/types'
import { reviewLabels } from '../../plan-review/labels'
import AgentPicker from './AgentPicker.vue'
import RemarkCard from './RemarkCard.vue'
const props = withDefaults(defineProps<{ projectId: string; workspaceId?: string | null; taskId: string; target?: ReviewTarget; defaultAgentId?: string | null; locked: boolean; readonly: boolean }>(), { target: 'plan' })
const emit = defineEmits<{ highlight: [ids: string[]]; counts: [counts: Record<string, number>]; attention: [count: number]; close: []; openPlanner: [sessionId: string] }>()
const target = toRef(props, 'target')
const L = computed(() => reviewLabels[props.target])
const state = usePlanReview(toRef(props, 'projectId'), toRef(props, 'taskId'), target)
const detail = state.detail, agents = useAgentsStore(), chats = useChatStore()
const activeRemarks = computed(() => detail.value?.remarks.filter(r => r.status !== 'applied') ?? [])
const appliedRemarks = computed(() => detail.value?.remarks.filter(r => r.status === 'applied') ?? [])
const appliedSection = shallowRef<HTMLDetailsElement>()
watch(state.counts, counts => emit('counts', counts), { immediate: true })
const wishField = ref<InstanceType<typeof ChatComposer>>(), skill = ref(''), skills = ref<Skill[]>([])
const origins = { direct: 'проект', group: 'группа', global: 'везде' }
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
  || (plannerWorking.value ? `${L.value.recipientNom} исправляет ${L.value.subject} по принятым карточкам…` : '')
  || (reviewerAnswering.value && phase.value === 'done' ? 'Ревьюер отвечает в карточках…' : ''))
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
const sendHint = computed(() => undecided.value ? `Сначала решите по всем карточкам: осталось ${undecided.value}` : acceptedCount.value ? `Принятые карточки уйдут ${L.value.recipient}: он исправит ${L.value.subject}` : 'Принятых карточек нет')
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
// Completing the report precedes the end of its agent turn. Only sent discussion messages mean an answer is pending.
const reviewerAnswering = computed(() => reviewerWorking.value && !!detail.value?.remarks.some(r =>
  r.status === 'discussing' && r.messages.at(-1)?.author === 'developer' && !!r.messages.at(-1)?.sent))
const phaseText = computed(() => ({ none: '', running: 'Ревью выполняется…', stalled: 'Ревьюер остановился', failed: 'Ревью не удалось', done: 'Ревью завершено' })[phase.value])
const stalledText = computed(() => {
  const why = reviewerChat.value?.status === 'error' ? 'Агент завершился с ошибкой' + (reviewerChat.value.reason ? ': ' + reviewerChat.value.reason : '') + '. ' : ''
  return phase.value === 'failed'
    ? why + 'Ревьюер не запустился. Проверьте агента в настройках и запустите ревью ещё раз.'
    : why + 'Ревьюер остановился, не сохранив итог (приложение закрывали или агент прервался). Готовые карточки можно разобрать, а ревью запустить ещё раз.'
})
const summaryLine = computed(() => {
  const parts: [string, number][] = [['Без решения', countOf('open')], ['Принято', countOf('accepted')], ['С ревьюером', countOf('discussing')],
    ['Отправлено', countOf('sent')], [`${L.value.recipientNom} ответил`, countOf('answered')], [`Учтено ${L.value.subjectIn}`, countOf('applied')], ['Отклонено', countOf('rejected')]]
  return parts.filter(([, n]) => n).map(([label, n]) => label + ' ' + n).join(' · ')
})
// One line telling what to do next, from the state of the cards.
const nextStep = computed(() => {
  if (!detail.value || !detail.value.remarks.length || props.readonly) return ''
  if (props.locked) return 'Очередь выполняется. Решения можно будет принимать, когда она закончится или будет остановлена.'
  if (countOf('answered')) return `${L.value.recipientNom} ответил. Прочитайте ответы и решите по карточкам: принять, отклонить или обсудить с ревьюером.`
  if (askCount.value) return 'Ваши сообщения ждут отправки. Нажмите «Отправить ревьюеру»: он ответит в карточках.'
  if (countOf('discussing')) return `Есть карточки в обсуждении с ревьюером. Когда он ответит, примите или отклоните их — тогда ${L.value.recipient} можно будет отправить принятые.`
  if (countOf('open')) return `Решите по каждой карточке: «Принять» — исправить ${L.value.subject}, «Обсудить» — спросить ревьюера, «Отклонить» — не согласен.`
  if (acceptedCount.value) return `По всем карточкам есть решения. Нажмите «Отправить ${L.value.recipient}»: он исправит ${L.value.subject} по принятым.`
  if (countOf('sent')) return `${L.value.recipientNom} работает над отправленными карточками. Ответы и правки появятся здесь.`
  return props.target === 'plan' ? 'Все замечания разобраны. Можно запускать очередь на вкладке «Выполнение» или проверить план ещё раз.'
    : 'Все замечания разобраны. Можно отметить раздел готовым или проверить документ ещё раз.'
})
const unfinishedText = computed(() => {
  if (!detail.value || !isLatest.value) return ''
  const parts = [undecided.value && 'без решения: ' + undecided.value, acceptedCount.value && 'не отправлено ' + L.value.recipient + ': ' + acceptedCount.value].filter(Boolean)
  return parts.length ? 'В текущем раунде осталось ' + parts.join(', ') + '. Новый раунд откроется отдельно: ревьюер увидит ваши решения как историю, но ' + L.value.recipient + ' они не уйдут.' : ''
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
// Identifiers of a document (D…/Q…) are looked up like the steps of a plan.
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
async function focusCard(id: string) {
  const remark = detail.value?.remarks.find(r => r.id === id)
  if (remark?.status === 'applied' && appliedSection.value) appliedSection.value.open = true
  focused.value = id
  await nextTick()
  cards.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
  void loadSkills(props.projectId, props.taskId)
}
// Project, group and global skills; the previous round's one stays chosen, else the first (as the server does).
async function loadSkills(p: string, t: string) {
  try {
    const value = await api.skills(p, t, props.target)
    if (p !== props.projectId || t !== props.taskId) return
    skills.value = value
    skill.value = value.find(s => s.id === state.reviews.value[0]?.skill_id)?.id || value[0]?.id || ''
  } catch { skills.value = []; skill.value = '' }
}
watch(() => [props.projectId, props.taskId, props.target, state.reviews.value[0]?.id], loadSetup, { immediate: true })
async function launch() {
  if (props.locked || props.readonly || !choice.value.agent_id) return
  // The wish is the text (its @path mentions are read by the reviewer in the project) and the attached text files.
  const blocks = wishField.value?.content() ?? []
  const wish = blocks.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n')
  const attachments = blocks.flatMap(b => b.type === 'resource' && 'text' in b.resource ? [{ name: decodeURIComponent(b.resource.uri.replace(/^file:\/+/, '')), content: b.resource.text }] : [])
  if (await state.run(() => api.launch(props.projectId, props.taskId, { ...choice.value, ...(skill.value ? { skill_id: skill.value } : {}), wish, ...(attachments.length ? { attachments } : {}) }, props.target))) { wishField.value?.clear(); setupOpen.value = false }
}
// No dialog: the planner that wrote the plan continues if it is free, otherwise a new one starts with the default agent.
// Sending asks who gets the cards: a free chat of the author (the one that wrote the document is preselected) or a new agent.
const NEW_RECIPIENT = 'new'
const sendOpen = ref(false)
const recipients = ref<{ id: string; title: string; available: boolean; busy: boolean }[]>([]), recipient = ref(NEW_RECIPIENT), authorChoice = ref<Launch>({ agent_id: '' })
// Chats are named as in the chat tabs: the entity and the number among the task's chats of this kind, oldest first.
const chatNames = computed(() => {
  const own = chats.sessions.filter(s => s.task_id === props.taskId && (props.target === 'plan' ? s.role === 'planner' : s.role === 'material-author' && s.metadata?.material_type === props.target))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  const label = { plan: 'План', architecture: 'Архитектура', qa: 'QA' }[props.target]
  return new Map(own.map((s, i) => [s.id, `${label} ${i + 1}`]))
})
const recipientOptions = computed(() => [
  ...recipients.value.map(s => ({ value: s.id, label: chatNames.value.get(s.id) ?? s.title, description: s.available ? '' : s.busy ? 'отвечает сейчас' : 'нельзя продолжить', disabled: !s.available })),
  { value: NEW_RECIPIENT, label: 'Новый агент' },
])
async function openSend() {
  if (!detail.value || props.locked || props.readonly || state.busy.value || !canSend.value) return
  try {
    const found = await api.recipients(props.projectId, props.taskId, props.target)
    recipients.value = found.sessions
    recipient.value = found.default_session_id ?? found.sessions.find(s => s.available)?.id ?? NEW_RECIPIENT
  } catch { recipients.value = []; recipient.value = NEW_RECIPIENT }
  sendOpen.value = true
}
async function send() {
  if (!detail.value || props.locked || props.readonly || state.busy.value || !canSend.value) return
  const fresh = recipient.value === NEW_RECIPIENT
  if (fresh && !authorChoice.value.agent_id) { state.error.value = 'Выберите агента, которому отправить карточки'; sendOpen.value = false; return }
  const input = fresh ? { ...authorChoice.value, session_id: null } : { session_id: recipient.value }
  sendOpen.value = false
  sending.value = `Отправляю карточки ${L.value.recipient}…`
  try { await state.run(() => api.send(props.projectId, props.taskId, detail.value!.review.id, input)) } finally { sending.value = '' }
}
watch(() => [props.projectId, props.taskId, props.target], () => { sendOpen.value = false; focused.value = ''; emit('highlight', []) })
watch(state.selected, () => { focused.value = ''; emit('highlight', []) })
</script>
<style scoped>
.review-panel { flex: 0 0 44%; min-width: 0; overflow-y: auto; padding: 16px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; font-size: var(--fs-md); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
h3, p { margin: 0; } h3 { font-size: var(--fs-md); }
.muted { color: var(--text-muted); }
.warn { color: var(--warning-text); }
.counts { color: var(--text-muted); font-size: var(--fs-sm); }
.next { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg2); }
.spacer { flex: 1; }
.applied-remarks > summary { cursor: pointer; color: var(--text-muted); font-size: var(--fs-sm); }
.applied-cards { display: flex; flex-direction: column; gap: var(--sp-3); margin-top: var(--sp-3); }
.error-box { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger-hover); }
.activity { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 600; background: var(--warning-soft); color: var(--warning-text); }
.activity .phase-dot { animation: phase-pulse 1.2s ease-in-out infinite; }
.report-link { padding: 8px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-hover); }
.report-link .link { margin-left: 4px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.phase { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 600; background: var(--bg3); color: var(--text-muted); }
.phase-dot { width: 8px; height: 8px; border-radius: var(--radius-round); background: currentColor; flex-shrink: 0; }
.phase-running { background: var(--warning-soft); color: var(--warning-text); }
.phase-running .phase-dot { animation: phase-pulse 1.2s ease-in-out infinite; }
.phase-done { background: var(--accent-soft); color: var(--accent-hover); }
.phase-failed, .phase-stalled { background: var(--danger-soft); color: var(--danger-hover); }
@keyframes phase-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.toolbar .on { background: var(--bg-hover); }
.setup { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); flex-shrink: 0; }
.setup-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 12px; }
.setup-label:last-of-type { align-self: start; padding-top: 8px; }
.setup-label { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.setup-controls { display: flex; align-items: center; gap: 6px; min-width: 0; }
.setup-actions { display: flex; justify-content: flex-end; }
.table-wrap { overflow-x: auto; flex-shrink: 0; }
table { border-collapse: collapse; width: 100%; font-size: var(--fs-sm); }
td, th { padding: 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.link { border: 0; background: none; color: var(--blue-hover); cursor: pointer; }
label { display: flex; flex-direction: column; gap: 6px; }
@media (max-width: 900px) { .review-panel { flex-basis: 50%; } }
</style>

