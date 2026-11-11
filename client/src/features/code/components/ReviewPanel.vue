<template>
  <section class="rp">
    <AgentReview v-if="origin.type === 'project'" v-model:journal="reviewerJournal" :project-id="projectId" :default-agent-id="defaultAgentId" />
    <!-- The review's agent: who it is, what it does now, its full log on demand. -->
    <div v-if="agent.session || agent.work || agent.sending" class="rp-agent">
      <template v-if="agent.session">
        <span class="rp-dot" :class="handing ? 'thinking' : agent.session.status" />
        <span class="rp-agent-name" :title="agent.session.title">{{ agentName || 'Агент' }}</span>
        <span class="rp-agent-status">{{ handing ? (agent.session.status === 'starting' ? 'Подключается' : 'Агент думает…') : statusLabel(agent.session.status) }}</span>
        <AppButton
          v-if="!readOnly" variant="link" size="xs" :disabled="!pending || agent.busy || agent.sending"
          :title="agent.busy ? 'Агент работает: дождитесь конца хода' : pending ? (agent.work ? 'Отдать замечания другому агенту или модели: он продолжит в папке этой работы' : 'Отдать замечания другому агенту или модели: дальше ревью продолжит он') : 'Нет пунктов, которые можно отправить'"
          @click="agent.setup = { ids: null }"
        >изменить</AppButton>
        <span class="rp-spacer" />
        <AppButton size="xs" variant="ghost" :title="journal ? 'Вернуться к замечаниям' : 'Полный лог агента: рассуждения, команды, настройки модели'" @click="reviewerJournal = ''; journal = !journal">{{ journal ? '← Замечания' : 'Журнал' }}</AppButton>
      </template>
      <span v-else-if="agent.work" class="rp-muted">Замечания уйдут агенту этой работы — он знает весь контекст</span>
      <template v-else-if="agent.sending">
        <span class="rp-dot thinking" />
        <span class="rp-agent-name">Агент запускается…</span>
      </template>
    </div>

    <!-- No agent yet: the review's agent is the project's one from the settings, ready to take «Отправить»; «Изменить» only for this review. -->
    <div v-if="!agent.session && !agent.work && !agent.sending && !readOnly" class="rp-pick">
      <ReviewAgentBar label="Агент для правок" :project-id="projectId" :fallback-agent-id="defaultAgentId" @change="pick = $event" />
    </div>

    <div v-if="agent.session" class="rp-agent-usage">
      <span>Контекст и лимиты</span>
      <UsageMeter :agent-id="agent.session.agent_id" :usage="usage" placement="below" show-unavailable />
    </div>

    <ChatView v-if="reviewerJournal" :key="reviewerJournal" :session-id="reviewerJournal" class="rp-journal" />
    <template v-else-if="journal && agent.sessionId">
      <ChatView :key="agent.sessionId" :session-id="agent.sessionId" class="rp-journal" />
    </template>

    <template v-else>
      <!-- «изменить» next to the agent: who takes the waiting items instead, set up like in the settings. -->
      <section v-if="agent.setup" class="rp-setup" aria-label="Другой агент">
        <ReviewAgentBar expanded :project-id="projectId" :fallback-agent-id="defaultAgentId" :disabled="agent.sending" @change="pick = $event" />
        <p v-if="agent.error" class="rp-error">{{ agent.error }}</p>
        <div class="rp-setup-foot">
          <AppButton variant="ghost" size="sm" :disabled="agent.sending" @click="agent.setup = null">Отмена</AppButton>
          <AppButton variant="blue" size="sm" :disabled="!pick || agent.sending" :title="`Ему уйдёт ${setupCount} ${plural(setupCount, 'пункт', 'пункта', 'пунктов')}`" @click="startWith(agent.setup.ids)">{{ agent.sending ? 'Запуск…' : 'Выбрать агента' }}</AppButton>
        </div>
      </section>
      <div v-else class="rp-actions">
        <AppButton size="xs" variant="ghost" :disabled="readOnly || composing" title="Замечание не к конкретной строке: структура, несколько файлов, общее впечатление" @click="composing = true">+ Общее</AppButton>
        <AppButton
          v-if="!readOnly" size="xs" variant="blue" :disabled="!pending || agent.busy || agent.sending"
          :title="agent.busy ? 'Агент работает: дождитесь конца хода' : pending ? 'Отправить агенту новые пункты и ваши ответы в обсуждениях' : 'Нечего отправлять'"
          @click="send"
        >{{ agent.sending ? 'Отправка…' : `Отправить${pending ? ' ' + pending : ''}` }}</AppButton>
        <FinishReview v-if="store.liveReview && !readOnly" class="rp-finish" />
      </div>
      <div v-if="agent.error && !agent.setup" class="rp-error">{{ agent.error }}</div>

      <!-- A permission the agent asked outside any item (it did not say what it works on). -->
      <div v-for="permission in loosePermissions" :key="permission.permissionId" class="rp-permission">
        <div class="rp-permission-head">Агент просит разрешение</div>
        <div class="rp-permission-title">{{ permission.toolCall.title }}</div>
        <div class="rp-permission-actions">
          <AppButton
            v-for="option in permission.options" :key="option.optionId" size="xs" :variant="option.kind.startsWith('allow') ? 'blue' : 'ghost'"
            @click="agent.answerPermission(permission.permissionId, option.optionId)"
          >{{ option.name }}</AppButton>
        </div>
      </div>

      <div v-if="items.length" class="rp-filters">
        <AppTabs compact bare :model-value="filter" :items="filters.map(f => ({ value: f.id, label: f.label, count: f.count }))" label="Какие пункты показать" @update:model-value="filter = $event as typeof filter" />
      </div>
      <div class="rp-meta">
        <template v-if="review">Ревью #{{ review.number }}<template v-if="rounds"> · отправок {{ rounds }}</template></template>
        <span v-if="readOnly" class="rp-ro" title="Это ревью другой ветки или завершено: только чтение">только чтение</span>
      </div>

      <div class="rp-list">
        <ItemComposer v-if="composing" where="Общее замечание" general :busy="busy" :error="error" @save="saveGeneral" @cancel="composing = false" />
        <div v-if="!items.length && !composing" class="rp-empty">
          Замечаний пока нет. Нажмите на номер строки в коде, 💬 в шапке файла или «+ Общее». Пункты копятся, агенту ничего не уходит, пока вы не нажмёте «Отправить».
          Потом переписывайтесь с агентом прямо в карточках: ответы тоже копятся и уходят одной отправкой.
        </div>
        <div v-else-if="!shown.length && !composing" class="rp-empty">Здесь пусто.</div>
        <RecentReviews v-if="store.screen === 'clean'" />
        <template v-for="(item, index) in shown" :key="item.id">
          <div v-if="state(item) === 'closed' && (index === 0 || state(shown[index - 1]) !== 'closed') && filter === 'all'" class="rp-section">Закрытые</div>
          <ItemView
            :item="item" :read-only="readOnly" show-location
            @goto="emit('goto', item)" @open-ref="emit('open-ref', $event)" @show-change="(round, file) => emit('show-change', round, file)"
          />
        </template>
        <template v-if="outdated.length && filter === 'all'">
          <div class="rp-section">Устарели ({{ outdated.length }})</div>
          <ItemView v-for="item in outdated" :key="item.id" :item="item" :read-only="readOnly" show-location @open-ref="emit('open-ref', $event)" />
        </template>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useDraft } from '@core/composables/useDraft'
import { useDraftsStore } from '@core/stores/drafts'
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import { useAppStore } from '@core/stores/app'
import { permissionPolicy, useAgentsStore } from '@features/agents'
import { ChatView, ReviewAgentBar, UsageMeter, statusLabel, type ReviewAgentPick, type UsageInfo } from '@features/agent-chat'
import { useCodeStore } from '../stores/code'
import { useReviewAgentStore } from '../stores/review-agent'
import type { CodeReviewItem } from '../types'
import { isSendable } from '../utils/accepted'
import { STATE_ORDER, threadState, type ThreadState } from '../utils/thread'
import FinishReview from './FinishReview.vue'
import ItemComposer from './ItemComposer.vue'
import RecentReviews from './RecentReviews.vue'
import ItemView from './ItemView.vue'
import AgentReview from './AgentReview.vue'

const props = defineProps<{
  projectId: string
  origin: { type: 'project' | 'task'; id: string }
  /** Agent preselected when the review's agent is set up: the task's agent, else the project's. */
  defaultAgentId?: string | null
}>()
const emit = defineEmits<{ goto: [item: CodeReviewItem]; 'open-ref': [ref: string]; 'show-change': [roundId: string, file?: string] }>()
const store = useCodeStore()
const agent = useReviewAgentStore()
const agents = useAgentsStore()
const app = useAppStore()
const composing = useDraft(() => `code-review:${store.review?.id ?? store.projectId}:general-composing`, () => false)
const journal = ref(false)
/** Session of the review agent whose log is open instead of the remarks (set by AgentReview). */
const reviewerJournal = ref('')
const busy = ref(false)
const error = ref('')
const filter = ref<'all' | 'waiting' | 'agent' | 'closed'>('all')

const DEFAULT_NOTE = 'Выполни замечания ревью.'
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

const review = computed(() => store.review)
const items = computed(() => store.items)
const readOnly = computed(() => store.readOnly || (!!store.openedReviewId && store.openedReview?.review.status !== 'open'))
const rounds = computed(() => store.openedReview?.rounds.length ?? store.current?.summary?.rounds ?? 0)
const usage = computed(() => (agent.session?.metadata.usage as UsageInfo | undefined) ?? null)
/** From «Отправить» until the agent reports it thinks: the session may say «Готов» in between, which must not show. */
const handing = computed(() => agent.sending || agent.awaiting)
const agentName = computed(() => agents.agents.find(a => a.id === agent.session?.agent_id)?.name ?? '')
/** What the agent bar (the line or the «изменить» form) currently holds. */
const pick = ref<ReviewAgentPick | null>(null)
/** Starts the picked agent on the given items (null — everything waiting). */
function startWith(ids: string[] | null) {
  if (!pick.value) return
  void agent.start(props.projectId, { agent_id: pick.value.agent_id, policy: permissionPolicy(pick.value.policy), model: pick.value.model, mode: pick.value.mode, config: pick.value.config, content: [{ type: 'text', text: DEFAULT_NOTE }] }, DEFAULT_NOTE, ids)
}
/** «Отправить»: the first one starts the agent of the bar at once, later ones go to the agent that is already there. */
function send() {
  if (agent.session || agent.work || !pick.value) return void agent.send()
  startWith(null)
}
const state = (item: CodeReviewItem): ThreadState => threadState(item, store.messages)
const live = computed(() => items.value.filter(i => !i.outdated))
const outdated = computed(() => items.value.filter(i => i.outdated))
/** What «Отправить» carries: new drafts and threads with queued replies. */
const pending = computed(() => live.value.filter(i => isSendable(i, state(i))).length)
const setupCount = computed(() => agent.setup?.ids?.length ?? pending.value)
const count = (states: ThreadState[]) => live.value.filter(i => states.includes(state(i))).length
const filters = computed(() => [
  { id: 'all' as const, label: 'Все', count: live.value.length },
  { id: 'waiting' as const, label: 'Ждут вас', count: count(['waiting']) },
  { id: 'agent' as const, label: 'У агента', count: count(['agent', 'queued']) },
  { id: 'closed' as const, label: 'Закрытые', count: count(['closed']) },
])
const FILTER_STATES: Record<typeof filter.value, ThreadState[] | null> = { all: null, waiting: ['waiting'], agent: ['agent', 'queued'], closed: ['closed'] }
const shown = computed(() => {
  const states = FILTER_STATES[filter.value]
  return live.value.filter(i => !states || states.includes(state(i))).sort((a, b) => STATE_ORDER[state(a)] - STATE_ORDER[state(b)])
})
/** Permissions not attached to a card: the agent did not say which item it works on. */
const loosePermissions = computed(() => (agent.focusItem && items.value.some(i => i.id === agent.focusItem) ? [] : agent.permissions))

async function saveGeneral(value: { kind: 'fix' | 'question'; text: string; refs: string[] }) {
  busy.value = true; error.value = ''
  try {
    const owner = store.review?.id ?? store.projectId
    await store.addDraft({ scope: 'general', ...value }, props.origin.type, props.origin.id)
    useDraftsStore().clearPrefix(`code-review:${owner}:composer:Общее замечание:`)
    composing.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить'; app.toast(error.value, 'error') }
  finally { busy.value = false }
}
</script>

<style scoped>
.rp { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.rp-agent { display: flex; align-items: center; gap: 6px; flex-shrink: 0; min-height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
.rp-pick { flex-shrink: 0; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.rp-agent-usage { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 8px 4px 12px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: var(--fs-xs); flex-shrink: 0; }
.rp-bar { flex: 1; min-width: 0; padding: 4px 0; }
.rp-agent-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-agent-status { color: var(--text-muted); white-space: nowrap; }
.rp-spacer { flex: 1; }
.rp-muted { color: var(--text-muted); }
.rp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: var(--radius-round); background: var(--border-strong); }
.rp-dot.thinking, .rp-dot.starting { background: var(--blue-hover); animation: rp-pulse 1.4s ease-in-out infinite; }
.rp-dot.waiting { background: var(--warning-text); }
.rp-dot.complete, .rp-dot.ready { background: var(--accent-hover); }
.rp-dot.error { background: var(--danger-hover); }
@keyframes rp-pulse { 50% { opacity: 0.35; } }
.rp-journal { flex: 1; min-height: 0; }
.rp-setup { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.rp-setup-foot { display: flex; justify-content: flex-end; gap: 6px; }
.rp-link { padding: 0; font: inherit; font-size: var(--fs-sm); font-weight: 400; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.rp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px 12px 4px; }
.rp-finish { margin-left: auto; }
.rp-error { margin: 0 12px 4px; font-size: var(--fs-sm); color: var(--danger-hover); }
.rp-permission { margin: 4px 12px; padding: 6px 8px; font-size: var(--fs-sm); border: 1px solid var(--blue); border-radius: var(--radius-sm); background: var(--blue-soft); }
.rp-permission-head { font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); }
.rp-permission-title { margin: 2px 0 6px; font-family: var(--font-mono); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.rp-permission-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.rp-filters { flex-shrink: 0; padding: 4px 12px 0; overflow-x: auto; border-bottom: 1px solid var(--border); }
.rp-filter { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; font: inherit; font-size: var(--fs-xs); color: var(--text-muted); background: none; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.rp-filter:hover { color: var(--text); }
.rp-filter.on { color: var(--text); border-color: var(--blue); background: var(--blue-soft); }
.rp-filter.warn .rp-filter-count { background: var(--warning-text); color: var(--bg); }
.rp-filter-count { min-width: 14px; padding: 0 4px; font-size: var(--fs-xs); font-weight: 600; text-align: center; border-radius: var(--radius-pill); background: var(--bg3); }
.rp-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 20px; padding: 8px 12px 6px; font-size: var(--fs-xs); color: var(--text-muted); }
.rp-ro { padding: 0 6px; font-size: var(--fs-xs); border-radius: var(--radius-pill); background: var(--bg3); color: var(--warning-text); }
.rp-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
.rp-empty { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.5; }
.rp-section { margin-top: 6px; font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
</style>
