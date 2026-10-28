<template>
  <div class="op">
    <section v-if="info" class="op-section">
      <div class="op-label">Описание МР</div>
      <MessageMarkdown v-if="info.mr.description.trim()" class="op-md op-description" :class="{ open: descriptionOpen }" :text="info.mr.description" />
      <span v-else class="op-muted">Автор не написал описание.</span>
      <button v-if="info.mr.description.length > 400" type="button" class="op-link" @click="descriptionOpen = !descriptionOpen">{{ descriptionOpen ? 'Свернуть' : 'Показать полностью' }}</button>
    </section>

    <!-- Before the review: what the agent should know. After the start none of it can change, only «Новое ревью». -->
    <section v-if="stage === 'setup'" class="op-section">
      <div class="op-label">Ревью агентом</div>
      <label class="op-field">Скилл ревью
        <span class="op-row">
          <PlainSelect :model-value="currentSkill" :options="skillOptions" small label="Скилл ревью" @update:model-value="save({ skill_id: $event || null })" />
          <button type="button" class="op-link" title="Скиллы ревью пишутся во вкладке «Инструкции» → «Ревью», в том числе вместе с агентом" @click="emit('open-instructions')">Скиллы ревью…</button>
        </span>
      </label>
      <label class="op-field">Задача
        <PlainSelect :model-value="detail.review.task_id ?? ''" :options="taskOptions" small label="Задача" empty-label="Задач нет" @update:model-value="save({ task_id: $event || null })" />
      </label>
      <label class="op-field">Что ещё знать агенту
        <textarea v-model="context" class="control op-text" rows="4" placeholder="Например: это первый шаг миграции на новый API, обратная совместимость не нужна" spellcheck="false" @blur="saveContext" />
      </label>
      <label class="op-field">На что смотреть особенно
        <input v-model="note" class="control control-sm" placeholder="Необязательно: например, только архитектура" spellcheck="false" @keydown.enter.prevent="start" />
      </label>
      <div class="op-row">
        <AppButton size="sm" variant="blue" :disabled="sending || busy" :title="busy ? 'Агент отвечает на вопросы: дождитесь конца ответа' : 'Агент из настроек проекта напишет сводку и черновики замечаний'" @click="start">{{ sending ? 'Запуск…' : 'Начать ревью' }}</AppButton>
        <span class="op-muted">Агент — из настроек проекта. Он только читает код.</span>
      </div>
    </section>

    <section v-else class="op-section">
      <div class="op-row">
        <p class="op-phase" :class="'op-phase-' + stage" role="status"><span class="op-dot" />{{ phaseText }}</p>
        <AppButton v-if="stage !== 'running'" size="sm" variant="ghost" :disabled="busy || restarting" :title="busy ? 'Агент отвечает на вопросы: дождитесь конца ответа' : 'Настроить и провести ревью заново, с новым агентом'" @click="restart">Новое ревью</AppButton>
      </div>
      <p v-if="stage === 'running'" class="op-muted">Можно читать diff и писать свои замечания. Черновики агента появятся во вкладке «Замечания».</p>
      <p v-else-if="problemText" class="op-warn">{{ problemText }}</p>
      <dl class="op-launch">
        <template v-for="row in launchRows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd></template>
      </dl>
      <button v-if="stage !== 'running' && agentRemarks" type="button" class="op-link" @click="emit('open-remarks')">
        Агент предложил {{ agentRemarks }} {{ plural(agentRemarks, 'замечание', 'замечания', 'замечаний') }} → к замечаниям
      </button>
    </section>
    <p v-if="error" role="alert" class="op-error">{{ error }}</p>

    <section v-if="detail.round_commits && stage !== 'running'" class="op-section op-round">
      <span>Автор добавил {{ detail.round_commits }} {{ plural(detail.round_commits, 'коммит', 'коммита', 'коммитов') }} после ваших замечаний, {{ changedCount }} {{ plural(changedCount, 'файл изменён', 'файла изменено', 'файлов изменено') }}.</span>
      <div class="op-row">
        <AppButton size="sm" variant="blue" :disabled="busy || sending" :title="busy ? 'Агент отвечает: дождитесь конца ответа' : 'Агент сверит ваши опубликованные замечания с новыми коммитами и ответит во вкладке «Агент»'" @click="checkFixes">Проверить исправления</AppButton>
        <button type="button" class="op-link" @click="screen.onlyChanged = !screen.onlyChanged">{{ screen.onlyChanged ? 'Показать все файлы' : 'Только изменённые' }}</button>
      </div>
    </section>

    <section v-if="stage !== 'setup'" class="op-section">
      <div class="op-label">Сводка</div>
      <p v-if="detail.review.overview && detail.review.overview_head !== detail.review.head" class="op-muted">Сводка написана к прошлой версии ветки.</p>
      <MessageMarkdown v-if="detail.review.overview" class="op-md" :text="detail.review.overview" />
      <span v-else class="op-muted">{{ stage === 'running' ? 'Сводка появится, когда агент изучит изменения.' : 'Агент не написал сводку.' }}</span>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '@core/api'
import type { Task } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useChatStore } from '@features/agent-chat'
import { useAgentsStore } from '@features/agents'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchReview, MrInfo, ReviewSkill } from '../types'
import { useReviewAgent } from '../composables/useReviewAgent'
import { plural } from '../utils'

/** The review by the agent in stages: setup, the agent working, its report. Starting over is «Новое ревью». */
const props = defineProps<{ screenKey: string; scope: string; detail: BranchReview; info: MrInfo | null; tasksUrl: string }>()
const emit = defineEmits<{ 'open-instructions': []; 'open-remarks': []; asked: [] }>()
const { screen, busy } = useReviewAgent(props.screenKey, computed(() => props.detail.review.head))
const app = useAppStore(), chats = useChatStore(), agents = useAgentsStore()
const skills = ref<ReviewSkill[]>([]), tasks = ref<Task[]>([])
const context = ref(props.detail.review.context), note = ref(''), error = ref(''), sending = ref(false), restarting = ref(false), descriptionOpen = ref(false)
watch(() => props.detail.review.context, value => { context.value = value })

const origin = { direct: 'проект', group: 'группа', global: 'везде' }
const skillOptions = computed(() => skills.value.length
  ? skills.value.map(s => ({ value: s.id, label: s.title + ' · ' + origin[s.origin] }))
  : [{ value: '', label: 'Стандартный (скиллов ревью нет)' }])
// The server falls back to the first available skill, so does the picker.
const currentSkill = computed(() => skills.value.find(s => s.id === props.detail.review.skill_id)?.id ?? skills.value[0]?.id ?? '')
const taskOptions = computed(() => [{ value: '', label: 'Без задачи' }, ...tasks.value.map(t => ({ value: t.id, label: t.key + (t.title ? ' · ' + t.title : '') }))])
const changedCount = computed(() => props.detail.files.filter(f => f.changed_since).length)
const agentRemarks = computed(() => screen.remarks.filter(r => r.author === 'agent').length)

// The review's own agent session: it is working while its chat is; a «running» review whose chat has stopped
// (the app was closed meanwhile) will never finish by itself. A fresh chat may not be in the store yet, hence the delay.
const reviewChat = computed(() => chats.sessions.find(s => s.id === props.detail.review.analysis_session))
const chatWorking = computed(() => ['starting', 'thinking'].includes(reviewChat.value?.status ?? ''))
const down = computed(() => props.detail.review.analysis_status === 'running' && !chatWorking.value)
const stalled = ref(false)
let stalledTimer: ReturnType<typeof setTimeout> | undefined
watch(down, value => { clearTimeout(stalledTimer); if (value) stalledTimer = setTimeout(() => { stalled.value = true }, 4000); else stalled.value = false }, { immediate: true })
onBeforeUnmount(() => clearTimeout(stalledTimer))
/** Reviews made before the stages existed have only an overview: they count as done. */
const stage = computed(() => {
  const status = props.detail.review.analysis_status
  if (!status) return props.detail.review.overview ? 'done' : 'setup'
  if (status === 'running') return stalled.value ? 'stopped' : 'running'
  return status
})
const agentName = computed(() => agents.agents.find(a => a.id === reviewChat.value?.agent_id)?.name ?? 'Агент')
const phaseText = computed(() => ({
  running: agentName.value + ' проводит ревью…', done: 'Ревью проведено', stopped: 'Ревью не закончено', failed: 'Ревью не удалось',
})[stage.value as 'running' | 'done' | 'stopped' | 'failed'])
const problemText = computed(() => {
  if (stage.value === 'failed') return 'Агент завершился с ошибкой' + (reviewChat.value?.reason ? ': ' + reviewChat.value.reason : '') + '. Готовое можно разобрать или начать новое ревью.'
  if (stage.value === 'stopped') return 'Агент остановился, не закончив ревью (его прервали или приложение закрывали). Готовое можно разобрать или начать новое ревью.'
  return ''
})
/** What the review was started with, for memory: nothing here can change any more. */
const launchRows = computed(() => {
  const r = props.detail.review
  const skill = skills.value.find(s => s.id === r.skill_id) ?? skills.value[0]
  const task = tasks.value.find(t => t.id === r.task_id)
  return ([
    ['Агент', reviewChat.value ? agentName.value : ''],
    ['Скилл', skill?.title ?? 'стандартный'],
    ['Задача', task ? task.key + (task.title ? ' · ' + task.title : '') : ''],
    ['Контекст', r.context.trim()],
    ['Особенно', r.analysis_note],
  ] as [string, string][]).filter(row => row[1])
})

async function load() {
  try { [skills.value, tasks.value] = await Promise.all([branchReviewApi.skills(props.scope), api.get<Task[]>(props.tasksUrl)]) }
  catch (cause) { error.value = errorText(cause) }
}
watch(() => props.scope, load, { immediate: true })
async function save(input: { context?: string; task_id?: string | null; skill_id?: string | null }) {
  try { screen.detail = await branchReviewApi.setContext(props.scope, props.detail.review.id, input) }
  catch (cause) { error.value = errorText(cause) }
}
async function start() {
  if (sending.value || busy.value) return
  sending.value = true; error.value = ''
  try {
    if (context.value !== props.detail.review.context) await save({ context: context.value })
    screen.thread = (await branchReviewApi.analyze(props.scope, props.detail.review.id, { note: note.value })).thread
    note.value = ''
    screen.detail = await branchReviewApi.detail(props.scope, props.detail.review.id)
  } catch (cause) { error.value = errorText(cause) } finally { sending.value = false }
}
function saveContext() { if (context.value !== props.detail.review.context) void save({ context: context.value }) }
async function checkFixes() {
  if (sending.value) return
  sending.value = true; error.value = ''
  try {
    const result = await branchReviewApi.checkFixes(props.scope, props.detail.review.id)
    screen.questions = result.questions; screen.messages = result.messages; screen.thread = result.thread
    emit('asked')
  } catch (cause) { error.value = errorText(cause) } finally { sending.value = false }
}
async function restart() {
  const untouched = screen.remarks.filter(r => r.author === 'agent' && r.status === 'draft' && !r.edited).length
  const message = 'Начать новое ревью? Его проведёт новый агент, настройки можно будет поменять. Сводка будет удалена' +
    (untouched ? `, как и ${untouched} ${plural(untouched, 'черновик', 'черновика', 'черновиков')} агента, которые вы не правили` : '') +
    '. Ваши замечания, поправленные черновики агента и вопросы к нему останутся.'
  if (!await app.confirm(message, { confirmLabel: 'Новое ревью' })) return
  restarting.value = true; error.value = ''
  try {
    screen.detail = await branchReviewApi.restart(props.scope, props.detail.review.id)
    screen.thread = null
    screen.remarks = (await branchReviewApi.remarks(props.scope, props.detail.review.id)).remarks
  } catch (cause) { error.value = errorText(cause) } finally { restarting.value = false }
}
</script>
<style scoped>
.op { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; padding: 6px 10px 12px; font-size: 12px; }
.op-section { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.op-section:last-child { border-bottom: none; }
.op-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.op-field { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); }
.op-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.op-text { width: 100%; min-height: 95px; flex-shrink: 0; padding: 6px 10px; line-height: 1.45; resize: vertical; font: inherit; color: var(--text); }
.op-muted { color: var(--text-muted); line-height: 1.45; }
.op-warn { color: var(--warning-text); line-height: 1.45; }
.op-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; align-self: flex-start; text-align: left; }
.op-md { font-size: 12.5px; line-height: 1.55; }
.op-description:not(.open) { max-height: 140px; overflow: hidden; }
.op-error { padding: 4px 0; color: var(--danger-hover); overflow-wrap: anywhere; }
.op-round { color: var(--warning-text); }
.op-phase { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 600; background: var(--bg3); color: var(--text-muted); }
.op-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.op-phase-running { background: rgba(210, 153, 34, 0.15); color: var(--warning-text); }
.op-phase-running .op-dot { animation: op-pulse 1.2s ease-in-out infinite; }
.op-phase-done { background: var(--accent-soft); color: var(--accent-hover); }
.op-phase-stopped, .op-phase-failed { background: var(--danger-soft); color: var(--danger-hover); }
@keyframes op-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.op-launch { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; margin: 0; color: var(--text-muted); }
.op-launch dt { color: var(--text-faint); }
.op-launch dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
