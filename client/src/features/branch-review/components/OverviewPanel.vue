<template>
  <div class="op">
    <section v-if="info" class="op-section">
      <div class="op-label">Описание МР</div>
      <MessageMarkdown v-if="info.mr.description.trim()" class="op-md op-description" :class="{ open: descriptionOpen }" :text="info.mr.description" />
      <span v-else class="op-muted">Автор не написал описание.</span>
      <button v-if="info.mr.description.length > 400" type="button" class="op-link" @click="descriptionOpen = !descriptionOpen">{{ descriptionOpen ? 'Свернуть' : 'Показать полностью' }}</button>
    </section>

    <section class="op-section">
      <div class="op-label">Контекст для агента</div>
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
        <textarea v-model="context" class="control op-text" rows="3" placeholder="Например: это первый шаг миграции на новый API, обратная совместимость не нужна" spellcheck="false" @blur="saveContext" />
      </label>
    </section>

    <section class="op-section">
      <div class="op-row">
        <div class="op-label">Разбор агентом</div>
        <span class="op-spacer" />
        <span v-if="busy" class="op-muted">{{ agentName }} работает…</span>
      </div>
      <NewChatPanel
        v-if="setup" compact class="op-setup" :project-id="scope" :default-agent-id="defaultAgentId" title="Агент" fixed-policy="read-only"
        :text="setup === 'analyze' ? 'Агент изучит МР по скиллу и контексту, напишет сводку и черновики замечаний. Код он только читает.' : 'Агент проверит, исправлены ли ваши опубликованные замечания. Ответ придёт на вкладку «Агент».'"
        initial-text="" :send-label="setup === 'analyze' ? 'Разобрать' : 'Проверить'" :busy="sending" @start="start(setup, $event)"
      >
        <template #actions><button type="button" class="op-link" @click="setup = null">Отмена</button></template>
      </NewChatPanel>
      <template v-else>
        <input v-model="note" class="control control-sm" placeholder="Пожелание к разбору (необязательно): например, только архитектура" spellcheck="false" @keydown.enter.prevent="click('analyze')" />
        <div class="op-row">
          <AppButton size="sm" variant="blue" :disabled="busy || sending" :title="busy ? 'Агент работает: дождитесь конца ответа' : 'Сводка и черновики замечаний по скиллу ревью'" @click="click('analyze')">{{ detail.review.overview ? 'Разобрать заново' : 'Разобрать агентом' }}</AppButton>
          <AppButton v-if="detail.review.published_head" size="sm" variant="ghost" :disabled="busy || sending" title="Агент сверит ваши опубликованные замечания с новыми коммитами" @click="click('check')">Проверить исправления</AppButton>
        </div>
      </template>
      <p v-if="error" role="alert" class="op-error">{{ error }}</p>
    </section>

    <section v-if="detail.round_commits" class="op-section op-round">
      После вашего ревью: {{ detail.round_commits }} {{ plural(detail.round_commits, 'коммит', 'коммита', 'коммитов') }}, {{ changedCount }} {{ plural(changedCount, 'файл изменён', 'файла изменено', 'файлов изменено') }}.
      <button type="button" class="op-link" @click="screen.onlyChanged = !screen.onlyChanged">{{ screen.onlyChanged ? 'Показать все файлы' : 'Только изменённые' }}</button>
    </section>

    <section class="op-section">
      <div class="op-label">Сводка</div>
      <p v-if="detail.review.overview && detail.review.overview_head !== detail.review.head" class="op-muted">Сводка написана к прошлой версии ветки.</p>
      <MessageMarkdown v-if="detail.review.overview" class="op-md" :text="detail.review.overview" />
      <span v-else class="op-muted">Нажмите «Разобрать агентом»: агент расскажет, что меняется и на что смотреть, и накидает черновики замечаний. Или сразу читайте diff и спрашивайте агента по строкам.</span>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@core/api'
import type { Task } from '@core/models'
import { NewChatPanel, type NewChatRequest } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchReview, MrInfo, ReviewSkill } from '../types'
import { pickOf, useReviewAgent } from '../composables/useReviewAgent'
import { plural } from '../utils'

/** The start of a review: the MR description, what the agent should know, the analysis and its overview. */
const props = defineProps<{ screenKey: string; scope: string; detail: BranchReview; info: MrInfo | null; tasksUrl: string; defaultAgentId?: string | null }>()
const emit = defineEmits<{ 'open-instructions': []; asked: [] }>()
const { screen, active, busy, agentName } = useReviewAgent(props.screenKey, computed(() => props.detail.review.head))
const skills = ref<ReviewSkill[]>([]), tasks = ref<Task[]>([])
const context = ref(props.detail.review.context), note = ref(''), error = ref(''), sending = ref(false), descriptionOpen = ref(false)
const setup = ref<'analyze' | 'check' | null>(null)
watch(() => props.detail.review.context, value => { context.value = value })

const origin = { direct: 'проект', group: 'группа', global: 'везде' }
const skillOptions = computed(() => skills.value.length
  ? skills.value.map(s => ({ value: s.id, label: s.title + ' · ' + origin[s.origin] }))
  : [{ value: '', label: 'Стандартный (скиллов ревью нет)' }])
// The server falls back to the first available skill, so does the picker.
const currentSkill = computed(() => skills.value.find(s => s.id === props.detail.review.skill_id)?.id ?? skills.value[0]?.id ?? '')
const taskOptions = computed(() => [{ value: '', label: 'Без задачи' }, ...tasks.value.map(t => ({ value: t.id, label: t.key + (t.title ? ' · ' + t.title : '') }))])
const changedCount = computed(() => props.detail.files.filter(f => f.changed_since).length)

async function load() {
  try { [skills.value, tasks.value] = await Promise.all([branchReviewApi.skills(props.scope), api.get<Task[]>(props.tasksUrl)]) }
  catch (cause) { error.value = errorText(cause) }
}
watch(() => props.scope, load, { immediate: true })
async function save(input: { context?: string; task_id?: string | null; skill_id?: string | null }) {
  try { screen.detail = await branchReviewApi.setContext(props.scope, props.detail.review.id, input) }
  catch (cause) { error.value = errorText(cause) }
}
function saveContext() { if (context.value !== props.detail.review.context) void save({ context: context.value }) }
/** Without an agent for this head the first run asks who should work. */
function click(kind: 'analyze' | 'check') {
  error.value = ''
  if (busy.value) return
  saveContext()
  if (!active.value) { setup.value = kind; return }
  void start(kind)
}
async function start(kind: 'analyze' | 'check', request?: NewChatRequest) {
  if (sending.value) return
  sending.value = true; error.value = ''
  try {
    const agent = pickOf(request), id = props.detail.review.id
    if (kind === 'analyze') screen.thread = (await branchReviewApi.analyze(props.scope, id, { agent, note: note.value })).thread
    else {
      const result = await branchReviewApi.checkFixes(props.scope, id, { agent })
      screen.questions = result.questions; screen.messages = result.messages; screen.thread = result.thread
      emit('asked')
    }
    setup.value = null; note.value = ''
  } catch (cause) { error.value = errorText(cause) } finally { sending.value = false }
}
</script>
<style scoped>
.op { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; padding: 6px 10px 12px; font-size: 12px; }
.op-section { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.op-section:last-child { border-bottom: none; }
.op-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.op-field { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); }
.op-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.op-spacer { flex: 1; }
.op-text { width: 100%; padding: 6px 10px; line-height: 1.45; resize: vertical; font: inherit; color: var(--text); }
.op-muted { color: var(--text-muted); line-height: 1.45; }
.op-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; align-self: flex-start; }
.op-md { font-size: 12.5px; line-height: 1.55; }
.op-description:not(.open) { max-height: 140px; overflow: hidden; }
.op-setup { border: 1px solid var(--border); border-radius: var(--radius-sm); }
.op-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.op-round { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--warning-text); }
</style>
