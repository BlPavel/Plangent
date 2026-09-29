<template>
  <section class="picker">
    <header class="picker-head">
      <span class="section-label">Шаги плана</span>
      <template v-if="selected.length">
        <span class="picker-selected">Выбрано: {{ selected.length }}</span>
        <span class="spacer" />
        <AppButton v-if="selectedUndone.length" variant="subtle" size="xs" @click="setDone(true)">Отметить выполненным</AppButton>
        <AppButton v-if="selectedDone.length" variant="subtle" size="xs" @click="setDone(false)">Вернуть в работу</AppButton>
        <AppButton variant="subtle" size="xs" @click="clear">Снять выбор</AppButton>
      </template>
      <template v-else>
        <span class="picker-progress">{{ doneCount }}/{{ steps.length }} выполнено</span>
        <span class="spacer" />
      </template>
    </header>

    <div class="steps">
      <div
        v-for="s in steps"
        :key="s.id ?? s.index"
        class="step"
        :class="{ done: s.done, selected: isSelected(s), queued: !s.done && stageOf(s) > 0 }"
        :style="!s.done && stageOf(s) ? { '--stage-color': stageColor(stageOf(s) - 1) } : undefined"
        @click="toggle(s)"
      >
        <span class="step-select" :class="{ on: isSelected(s) }">
          <svg v-if="isSelected(s)" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
        <code v-if="s.id" class="step-id">{{ s.id }}</code>
        <span class="step-text">{{ s.text }}</span>
        <span v-if="s.parallelGroup" class="step-tag parallel" :title="`Метка плана @parallel:${s.parallelGroup}`">∥ {{ s.parallelGroup }}</span>
        <span v-if="s.done" class="step-tag done">✓ готово</span>
        <span v-else-if="stageOf(s)" class="step-tag queued">этап {{ stageOf(s) }}</span>
      </div>
    </div>

    <div v-if="!taskDone" class="builder" :class="{ locked: !editable }">
      <div class="builder-head">
        <span class="builder-title">Добавить в очередь</span>
        <span class="builder-status">{{ builderStatus }}</span>
        <span class="spacer" />
        <AppButton
          v-if="editable && freeSteps.length"
          variant="subtle"
          size="xs"
          :disabled="!agentId"
          title="Добавить все невыполненные шаги с настройками ниже: каждый шаг — отдельный этап со своим агентом, по порядку плана. Шаги с одинаковой меткой @parallel встанут в один этап и пойдут параллельно"
          @click="addFromPlan"
        >Разложить весь план</AppButton>
      </div>
      <div class="builder-grid">
        <span class="builder-label">Агент</span>
        <div class="builder-controls">
          <AppSelect v-model="agentId" :options="agentOptions" size="sm" :disabled="!editable" />
          <AppSelect v-if="modelChoices.length" v-model="model" :options="modelChoices" prefix="Модель" size="sm" :disabled="!editable" />
          <AppSelect v-if="effortChoices.length" v-model="effort" :options="effortChoices" prefix="Рассуждения" size="sm" :disabled="!editable" />
        </div>
        <span class="builder-label">Работа</span>
        <div class="builder-controls">
          <AppSelect v-model="mode" :options="MODE_OPTIONS" size="sm" :disabled="!editable" />
          <AppSelect v-model="policy" :options="POLICY_OPTIONS" size="sm" :disabled="!editable" heading="Опасные команды (rm -rf, git push --force и т. п.) всегда спрашиваются" />
        </div>
        <span class="builder-label">Куда</span>
        <div class="builder-controls">
          <AppSelect v-model="target" :options="targetOptions" size="sm" :disabled="!editable" heading="Шаги одного этапа выполняются параллельно" />
          <span class="spacer" />
          <AppButton variant="primary" size="sm" :disabled="!editable || !agentId || !addable.length" :title="addTitle" @click="add">
            Добавить{{ addable.length ? ` ${addable.length} ${stepsWord(addable.length)}` : '' }}
          </AppButton>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import type { ExecutionPolicy, Plan, PlanStep, QueueSessionMode } from '@core/models'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import { TaskQueueKey } from '../composables/useTaskQueue'
import { MODE_OPTIONS, POLICY_OPTIONS, stageColor } from '../utils/queue-status'

const props = defineProps<{ plan: Plan; projectId: string; taskId: string; taskDone: boolean; defaultAgentId?: string | null }>()
const emit = defineEmits<{ planChanged: [plan: Plan] }>()

const app = useAppStore()
const queue = inject(TaskQueueKey)!
const agentsStore = useAgentsStore()
const chatStore = useChatStore()

const steps = computed(() => props.plan.steps)
const doneCount = computed(() => steps.value.filter(s => s.done).length)
const editable = computed(() => !queue.frozen.value)
const freeSteps = computed(() => steps.value.filter(s => s.id && !s.done && !queue.assigned.value.has(s.id)))

// ── Selection ──
const selectedIds = ref(new Set<string>())
const isSelected = (s: PlanStep) => !!s.id && selectedIds.value.has(s.id)
function toggle(s: PlanStep) {
  if (!s.id || props.taskDone) return
  const next = new Set(selectedIds.value)
  if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
  selectedIds.value = next
}
function clear() { selectedIds.value = new Set() }
const selected = computed(() => steps.value.filter(isSelected))
const selectedDone = computed(() => selected.value.filter(s => s.done))
const selectedUndone = computed(() => selected.value.filter(s => !s.done))
const addable = computed(() => selectedUndone.value.map(s => s.id!).filter(id => !queue.assigned.value.has(id)))
// Steps disappear or get renumbered when the plan changes: drop stale selections.
watch(steps, list => {
  const ids = new Set(list.map(s => s.id))
  selectedIds.value = new Set([...selectedIds.value].filter(id => ids.has(id)))
})

function stageOf(s: PlanStep) {
  const i = queue.stages.value.findIndex(st => st.sessions.some(x => x.status !== 'complete' && x.points.includes(s.id ?? '')))
  return i >= 0 ? i + 1 : 0
}

// ── New session settings ──
const agents = computed(() => agentsStore.agents)
const agentOptions = computed(() => agents.value.map(a => ({ value: a.id, label: a.name })))
const agentId = ref(props.defaultAgentId ?? '')
watch(agents, list => { if (!agentId.value && list.length) agentId.value = list[0].id }, { immediate: true })
const agent = computed(() => agents.value.find(a => a.id === agentId.value))
const modelOverride = ref<string | null>(null)
const effortOverride = ref<string | null>(null)
watch(agentId, id => {
  modelOverride.value = null
  effortOverride.value = null
  if (id && !chatStore.agentOptions[id]) void chatStore.fetchAgentOptions(id)
}, { immediate: true })
const reported = computed(() => modelAndEffort(chatStore.agentOptions[agentId.value]))
const modelChoices = computed(() => reported.value.models)
const effortChoices = computed(() => reported.value.efforts)
const model = computed({ get: () => modelOverride.value ?? agent.value?.model ?? '', set: v => { modelOverride.value = v } })
const effort = computed({ get: () => effortOverride.value ?? agent.value?.reasoning_effort ?? '', set: v => { effortOverride.value = v } })
const mode = ref<QueueSessionMode>('execute')
const policy = ref<ExecutionPolicy>('allow-all')
const target = ref('new')
const targetOptions = computed(() => [
  { value: 'new', label: 'Новым этапом', description: 'Выполнится после всех этапов очереди' },
  ...queue.stages.value.map((st, i) => ({
    value: st.id,
    label: `Параллельно с этапом ${i + 1}`,
    description: `Запустится одновременно с ${st.sessions.length > 1 ? 'шагами' : 'шагом'} этапа ${i + 1}`,
    disabled: st.sessions.every(s => s.status === 'complete'),
  })),
])
watch(() => queue.stages.value.map(st => st.id).join(), () => {
  if (target.value !== 'new' && !queue.stages.value.some(st => st.id === target.value)) target.value = 'new'
})

const settings = () => ({
  agentId: agentId.value,
  queueMode: mode.value,
  permissionPolicy: policy.value,
  model: model.value || undefined,
  reasoningEffort: effort.value || undefined,
})

const skipped = computed(() => selected.value.length - addable.value.length)
const builderStatus = computed(() => {
  if (!editable.value) return 'Очередь выполняется — остановите её, чтобы добавить шаги'
  if (!selected.value.length) return 'Отметьте шаги в списке выше'
  if (!addable.value.length) return 'Выбранные шаги уже в очереди или готовы'
  return skipped.value ? `${skipped.value} из выбранных уже в очереди или готовы — их пропустим` : ''
})
const addTitle = computed(() => addable.value.length ? addable.value.join(', ') : builderStatus.value)

function stepsWord(n: number) {
  const tens = n % 100, ones = n % 10
  return tens >= 11 && tens <= 14 ? 'шагов' : ones === 1 ? 'шаг' : ones >= 2 && ones <= 4 ? 'шага' : 'шагов'
}

async function add() {
  if (!agentId.value || !addable.value.length) return
  await queue.addSessions([{ ...settings(), points: [...addable.value] }], target.value)
  clear()
}
function addFromPlan() { void queue.addFromPlan(freeSteps.value, settings()) }

async function setDone(done: boolean) {
  const list = done ? selectedUndone.value : selectedDone.value
  try {
    let plan = props.plan
    for (const step of list) {
      plan = await api.patch<Plan>(`/projects/${props.projectId}/tasks/${props.taskId}/plans/${plan.id}/step/${step.index}`, { done })
    }
    emit('planChanged', plan)
    clear()
  } catch (e) { app.toast(String(e), 'error') }
}
</script>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 8px; }
.picker-head { display: flex; align-items: center; gap: 8px; min-height: var(--size-xs); }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.picker-progress { font-size: 12px; color: var(--text-faint); }
.spacer { flex: 1; }

.steps { display: flex; flex-direction: column; gap: 2px; }
.step { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid transparent; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.step:hover { background: var(--bg3); }
/* Already in the queue: the stage's colour as a bar and a faint tint */
.step.queued { box-shadow: inset 3px 0 0 var(--stage-color); background: color-mix(in srgb, var(--stage-color) 7%, transparent); }
.step.queued:hover { background: color-mix(in srgb, var(--stage-color) 12%, transparent); }
.step.selected { border-color: var(--blue); background: var(--blue-soft); }
.step.done .step-text { color: var(--text-muted); text-decoration: line-through; text-decoration-color: var(--text-faint); }
.step-select { width: 16px; height: 16px; border: 1.5px solid var(--border-strong); border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
.step-select.on { background: var(--blue); border-color: var(--blue); }
.step-select svg { width: 12px; height: 12px; }
.step-id { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
.step-text { flex: 1; min-width: 0; }
.step-tag { font-size: 10.5px; padding: 1px 7px; border-radius: var(--radius-pill); white-space: nowrap; flex-shrink: 0; }
.step-tag.done { color: var(--accent-hover); background: var(--accent-soft); }
.step-tag.queued { color: var(--stage-color); border: 1px solid color-mix(in srgb, var(--stage-color) 45%, transparent); }
.step-tag.parallel { color: var(--blue-hover); background: var(--blue-soft); }

.picker-selected { font-size: 12px; color: var(--blue-hover); font-weight: 600; }

.builder { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg2); }
.builder-head { display: flex; align-items: center; gap: 8px; min-height: var(--size-xs); }
.builder-title { font-size: 12.5px; font-weight: 600; }
.builder-status { font-size: 12px; color: var(--text-faint); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.builder-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 12px; }
.builder-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.builder-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
</style>
