<template>
  <div
    class="session"
    :class="[`tone-${state.tone}`, { selected, attention: state.attention, live: state.live, done: session.status === 'complete', draggable: canDrag }]"
    :draggable="canDrag"
    @dragstart="onDragStart"
    @dragend="$emit('dragEnd')"
    @click="$emit('select')"
  >
    <div class="session-main">
      <span v-if="canDrag" class="grip" title="Перетащите на другой этап, чтобы выполнять параллельно, или между этапами — чтобы сделать отдельным этапом">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.2" /><circle cx="10" cy="4" r="1.2" /><circle cx="6" cy="8" r="1.2" /><circle cx="10" cy="8" r="1.2" /><circle cx="6" cy="12" r="1.2" /><circle cx="10" cy="12" r="1.2" /></svg>
      </span>
      <span class="dot" />
      <div class="session-text">
        <div class="session-title">
          <span class="agent">{{ agentName }}</span>
          <code class="points" :title="session.points.join(', ')">{{ pointsText }}</code>
          <span v-if="session.queueMode === 'review_first'" class="tag" title="Агент сначала изучает шаги без правок и ждёт вашей команды">сначала обсудить</span>
          <span v-if="session.reviewerId" class="tag" :title="`Ревью: ${reviewerName}`">ревью</span>
          <span v-if="session.permissionPolicy !== 'allow-all'" class="tag">{{ policyShort }}</span>
        </div>
        <div class="session-step" :title="stepsTitle">{{ firstStepText }}</div>
      </div>
      <span class="status-badge" :class="state.tone">{{ state.label }}</span>
      <AppButton
        v-if="editable && session.status !== 'complete'"
        variant="subtle"
        size="sm"
        icon
        :class="{ on: showSettings }"
        title="Настройки шага"
        @click.stop="showSettings = !showSettings"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /><circle cx="10" cy="4.5" r="1.5" stroke="currentColor" stroke-width="1.4" /><circle cx="6" cy="11.5" r="1.5" stroke="currentColor" stroke-width="1.4" /></svg>
      </AppButton>
      <AppMenu v-if="menuItems.length" :items="menuItems" />
    </div>

    <div v-if="state.detail && session.status !== 'complete'" class="session-detail" :class="{ ask: state.attention }">
      <span class="detail-text">{{ state.detail }}</span>
      <AppButton v-if="session.status === 'ready_for_execution'" variant="primary" size="xs" @click.stop="queue.sessionAction(session.id, 'execute')">Приступить к выполнению</AppButton>
      <AppButton v-else-if="state.attention" variant="ghost" size="xs" @click.stop="$emit('open')">Ответить</AppButton>
    </div>

    <div v-if="showSettings && editable" class="settings" @click.stop>
      <label><span>Агент</span><AppSelect :model-value="session.agentId" :options="agentOptions" size="sm" @update:model-value="patch({ agentId: $event, model: undefined, reasoningEffort: undefined })" /></label>
      <label v-if="modelChoices.length"><span>Модель</span><AppSelect :model-value="session.model ?? agent?.model ?? ''" :options="modelChoices" size="sm" placeholder="По умолчанию" @update:model-value="patch({ model: $event })" /></label>
      <label v-if="effortChoices.length"><span>Рассуждения</span><AppSelect :model-value="session.reasoningEffort ?? agent?.reasoning_effort ?? ''" :options="effortChoices" size="sm" placeholder="По умолчанию" @update:model-value="patch({ reasoningEffort: $event })" /></label>
      <label><span>Режим</span><AppSelect :model-value="session.queueMode" :options="MODE_OPTIONS" size="sm" @update:model-value="patch({ queueMode: $event as QueueSessionMode })" /></label>
      <label><span>Разрешения</span><AppSelect :model-value="session.permissionPolicy" :options="POLICY_OPTIONS" size="sm" heading="Опасные команды (rm -rf, git push --force и т. п.) всегда спрашиваются" @update:model-value="patch({ permissionPolicy: $event as ExecutionPolicy })" /></label>
      <label><span>Ревью</span><AppSelect :model-value="session.reviewerId ?? ''" :options="reviewOptions" size="sm" @update:model-value="patch({ reviewerId: $event || undefined })" /></label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import type { Agent, ExecutionPolicy, OrchestratorQueueSession, PlanStep, QueueSessionMode, QueueStage } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import { TaskQueueKey, liveSessionMenu } from '../composables/useTaskQueue'
import { pointsLabel, MODE_OPTIONS, POLICY_OPTIONS, type SessionState } from '../utils/queue-status'

const props = defineProps<{
  session: OrchestratorQueueSession
  stage: QueueStage
  stageNumber: number
  state: SessionState
  agents: Agent[]
  steps: PlanStep[]
  selected: boolean
  editable: boolean
}>()
const emit = defineEmits<{ select: []; open: []; dragStart: [id: string]; dragEnd: [] }>()

const queue = inject(TaskQueueKey)!
const chatStore = useChatStore()
const showSettings = ref(false)

const agent = computed(() => props.agents.find(a => a.id === props.session.agentId))
const agentName = computed(() => agent.value?.name ?? props.session.agentId)
const reviewerName = computed(() => props.agents.find(a => a.id === props.session.reviewerId)?.name ?? '')
const agentOptions = computed(() => props.agents.map(a => ({ value: a.id, label: a.name })))
const reviewOptions = computed(() => [{ value: '', label: 'Без ревью' }, ...props.agents.map(a => ({ value: a.id, label: `Ревью: ${a.name}` }))])
const options = computed(() => modelAndEffort(chatStore.agentOptions[props.session.agentId]))
const modelChoices = computed(() => options.value.models)
const effortChoices = computed(() => options.value.efforts)
watch([showSettings, () => props.session.agentId], ([open, id]) => {
  if (open && id && !chatStore.agentOptions[id]) void chatStore.fetchAgentOptions(id)
})

const pointsText = computed(() => pointsLabel(props.session.points))
const sessionSteps = computed(() => props.session.points.map(p => props.steps.find(s => s.id === p)).filter((s): s is PlanStep => !!s))
const firstStepText = computed(() => {
  const [first, ...rest] = sessionSteps.value
  if (!first) return 'Шаг удалён из плана'
  return rest.length ? `${first.text} и ещё ${rest.length}` : first.text
})
const stepsTitle = computed(() => sessionSteps.value.map(s => `${s.id}. ${s.text}`).join('\n'))
const policyShort = computed(() => props.session.permissionPolicy === 'ask' ? 'спрашивает всё' : 'только правки')

const canDrag = computed(() => props.editable && props.session.status !== 'complete')
function onDragStart(e: DragEvent) {
  e.dataTransfer?.setData('text/plain', props.session.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  // The drop zones appear once dragging is on; changing the page inside dragstart itself makes Chromium cancel the drag.
  const id = props.session.id
  setTimeout(() => emit('dragStart', id))
}

function stageHint(st: QueueStage) {
  return st.sessions.map(x => `${props.agents.find(a => a.id === x.agentId)?.name ?? x.agentId} · ${pointsLabel(x.points)}`).join(', ')
}

function patch(p: Partial<OrchestratorQueueSession>) { void queue.updateSession(props.session.id, p) }

const menuItems = computed<MenuItem[]>(() => {
  const s = props.session
  if (props.editable) {
    const others = queue.stages.value
      .map((st, i) => ({ st, i }))
      .filter(({ st }) => st.id !== props.stage.id && st.sessions.some(x => x.status !== 'complete'))
    return [
      ...(others.length ? [{ heading: 'Выполнять параллельно с' }] : []),
      ...others.map(({ st, i }) => ({ label: `Этапом ${i + 1}`, hint: stageHint(st), action: () => queue.moveSession(s.id, { stageId: st.id }) })),
      ...(props.stage.sessions.length > 1 ? [{ separator: true }, { label: 'Выполнять отдельным этапом', hint: 'Вынести из параллельной группы', action: () => queue.splitSession(s.id) }] : []),
      { separator: true },
      { label: 'Удалить из очереди', danger: true, action: () => queue.removeSession(s.id) },
    ]
  }
  return props.state.live ? liveSessionMenu(queue, s) : []
})
</script>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 8px 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg2);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.session:hover { border-color: var(--border-strong); }
.session.selected { border-color: var(--blue); background: var(--blue-soft); }
.session.attention { border-color: var(--warning); }
.session.attention.selected { background: var(--warning-soft); }
.session.done { background: transparent; }
.session.done .agent, .session.done .session-step { color: var(--text-muted); }
.session.draggable { cursor: grab; }

.session-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.grip { display: flex; color: var(--text-faint); margin: 0 -4px 0 -4px; cursor: grab; }
.grip svg { width: 14px; height: 14px; }
.session:hover .grip { color: var(--text-muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--border-strong); }
.tone-open .dot { background: var(--blue-hover); }
.tone-progress .dot { background: var(--warning-text); }
.tone-done .dot { background: var(--accent-hover); }
.tone-danger .dot { background: var(--danger-hover); }
.live .dot { animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.session-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.session-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; }
.agent { font-weight: 600; white-space: nowrap; }
.points { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); padding: 0 6px; white-space: nowrap; }
.session-step { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status-badge { flex-shrink: 0; }
.btn.on { background: var(--bg3); color: var(--text); }
.btn svg { width: 14px; height: 14px; }

.session-detail { display: flex; align-items: center; gap: 8px; margin-left: 16px; font-size: 12px; color: var(--text-muted); }
.session-detail.ask { color: var(--warning-text); }
.detail-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.settings { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin-left: 16px; padding-top: 8px; border-top: 1px solid var(--border); cursor: default; }
.settings label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); }
.settings :deep(.select) { width: 100%; }
</style>
