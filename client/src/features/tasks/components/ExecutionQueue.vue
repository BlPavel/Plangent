<template>
  <section class="queue">
    <header class="queue-head">
      <div class="queue-heading">
        <span class="section-label">Очередь</span>
        <span class="status-badge" :class="statusTone">{{ statusText }}</span>
        <span v-if="summary" class="queue-summary">{{ summary }}</span>
      </div>
      <div class="queue-controls">
        <template v-if="status === 'running'">
          <AppButton
            size="sm"
            :variant="queue.queue.value?.pauseRequested ? 'blue' : 'ghost'"
            :title="queue.queue.value?.pauseRequested ? 'Очередь встанет на паузу, когда закончится текущий этап. Нажмите, чтобы отменить' : 'Поставить очередь на паузу, когда закончится текущий этап'"
            @click="queue.pauseAfterStage(!queue.queue.value?.pauseRequested)"
          >⏸ {{ queue.queue.value?.pauseRequested ? 'Пауза после этапа' : 'Пауза' }}</AppButton>
          <AppButton size="sm" variant="danger-ghost" @click="stop">■ Остановить</AppButton>
        </template>
        <template v-else-if="status === 'paused'">
          <AppButton size="sm" variant="primary" @click="queue.resume()">▶ Продолжить</AppButton>
          <AppButton size="sm" variant="danger-ghost" @click="stop">■ Остановить</AppButton>
        </template>
        <template v-else>
          <AppButton v-if="pendingCount && !taskDone" size="sm" variant="primary" @click="$emit('start')">
            ▶ {{ resumable ? 'Продолжить' : 'Запустить' }}
          </AppButton>
          <AppMenu v-if="stages.length || history.length" :items="queueMenu" title="Очередь" />
        </template>
      </div>
    </header>

    <div v-if="status === 'paused'" class="banner warn">
      Этап {{ (queue.queue.value?.stageIndex ?? 0) + 1 }} выполнен. Проверьте результат и продолжите очередь.
    </div>
    <div v-else-if="status === 'stopped' || status === 'failed'" class="banner">
      {{ queue.queue.value?.reason || 'Очередь остановлена' }}.
      <template v-if="pendingCount"> Невыполненные шаги запустятся снова, когда вы продолжите очередь.</template>
    </div>
    <div v-else-if="frozen" class="banner subtle">Очередь выполняется и не редактируется. Чтобы что-то поменять, остановите её.</div>

    <div v-if="!stages.length" class="queue-empty">
      <template v-if="history.length">Предыдущая очередь выполнена — она в истории ниже. Добавьте шаги, чтобы собрать новую.</template>
      <template v-else>Выберите шаги плана и добавьте их в очередь. Шаги одного этапа выполняются параллельно, этапы — по порядку.</template>
    </div>

    <div v-if="editable && pendingCount > 1" class="queue-hint">
      Чтобы шаги шли параллельно, перетащите карточку за ⠿ на другой этап или выберите этап в её меню ⋯. Между этапами — отдельный этап.
    </div>

    <div class="stages" :class="{ dragging: !!dragId }">
      <template v-for="(stage, i) in stages" :key="stage.id">
        <div
          v-if="dragId"
          class="gap-drop"
          :class="{ over: overGap === i }"
          @dragover.prevent="overGap = i; overStage = null"
          @dragleave="overGap = null"
          @drop.prevent="drop({ index: i })"
        >Отдельным этапом</div>
        <div
          class="stage"
          :style="{ '--stage-color': stageColor(i) }"
          :class="{ current: frozen && i === queue.queue.value?.stageIndex, finished: isFinished(stage), parallel: stage.sessions.length > 1, over: overStage === stage.id }"
          @dragover.prevent="dragId && (overStage = stage.id, overGap = null)"
          @dragleave.self="overStage = null"
          @drop.prevent="drop({ stageId: stage.id })"
        >
          <div class="stage-head">
            <span class="stage-num"><span class="stage-dot" />Этап {{ i + 1 }}</span>
            <span v-if="stage.sessions.length > 1" class="stage-parallel" title="Шаги этого этапа выполняются одновременно">∥ параллельно · {{ stage.sessions.length }}</span>
            <span v-if="frozen && i === queue.queue.value?.stageIndex" class="stage-current">{{ status === 'paused' ? 'на паузе' : 'сейчас' }}</span>
            <span class="spacer" />
            <button
              v-if="editable && i < stages.length - 1"
              type="button"
              class="pause-toggle"
              :class="{ on: stage.pauseAfter }"
              :title="stage.pauseAfter ? 'Очередь остановится после этого этапа — нажмите, чтобы убрать' : 'Остановить очередь после этого этапа, чтобы проверить результат'"
              @click="queue.updateStage(stage.id, { pauseAfter: !stage.pauseAfter })"
            >⏸ пауза после</button>
            <span v-else-if="stage.pauseAfter && i < stages.length - 1" class="pause-toggle on static">⏸ пауза после</span>
            <AppMenu v-if="editable" :items="stageMenu(stage)" size="xs" title="Этап" />
          </div>
          <div class="stage-sessions">
            <QueueSessionItem
              v-for="s in stage.sessions"
              :key="s.id"
              :session="s"
              :stage="stage"
              :stage-number="i + 1"
              :state="stateOf(s)"
              :agents="agents"
              :steps="steps"
              :selected="selectedId === s.id"
              :editable="editable"
              @select="$emit('select', s.id)"
              @open="$emit('open', s.id)"
              @drag-start="dragId = $event"
              @drag-end="endDrag"
            />
          </div>
        </div>
      </template>
      <div
        v-if="dragId && stages.length"
        class="gap-drop"
        :class="{ over: overGap === stages.length }"
        @dragover.prevent="overGap = stages.length; overStage = null"
        @dragleave="overGap = null"
        @drop.prevent="drop({ index: stages.length })"
      >Отдельным этапом в конец</div>
    </div>

    <!-- Earlier runs: out of the way, but their agents' chats stay one click away -->
    <div v-if="history.length" class="history">
      <button type="button" class="history-toggle" @click="showHistory = !showHistory">
        <svg :class="{ open: showHistory }" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Выполненные ранее · {{ history.length }} {{ runsWord(history.length) }}
      </button>
      <div v-if="showHistory" class="history-runs">
        <div v-for="run in history" :key="run.id" class="history-run">
          <div class="history-date">{{ formatDate(run.finishedAt) }}</div>
          <template v-for="(stage, i) in run.stages" :key="stage.id">
            <QueueSessionItem
              v-for="s in stage.sessions"
              :key="s.id"
              class="history-session"
              :session="s"
              :stage="stage"
              :stage-number="i + 1"
              :state="stateOf(s)"
              :agents="agents"
              :steps="steps"
              :selected="selectedId === s.id"
              :editable="false"
              @select="$emit('select', s.id)"
              @open="$emit('open', s.id)"
            />
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { Agent, OrchestratorQueueSession, PlanStep, QueueStage } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import { useAppStore } from '@core/stores/app'
import { useChatStore } from '@features/agent-chat'
import { TaskQueueKey } from '../composables/useTaskQueue'
import { queueStatusLabel, sessionState, stageColor } from '../utils/queue-status'
import QueueSessionItem from './QueueSessionItem.vue'

defineProps<{ agents: Agent[]; steps: PlanStep[]; selectedId: string | null; taskDone: boolean }>()
defineEmits<{ select: [id: string]; open: [id: string]; start: [] }>()

const queue = inject(TaskQueueKey)!
const app = useAppStore()
const chatStore = useChatStore()

const stages = computed(() => queue.stages.value)
const status = computed(() => queue.queue.value?.status ?? 'idle')
const frozen = computed(() => queue.frozen.value)
const editable = computed(() => !frozen.value)

function chat(id?: string) { return id ? chatStore.sessions.find(c => c.id === id) : undefined }
function stateOf(s: OrchestratorQueueSession) { return sessionState(s, chat(s.sessionId), chat(s.reviewSessionId)) }
const isFinished = (stage: QueueStage) => stage.sessions.every(s => s.status === 'complete')

const states = computed(() => queue.sessions.value.map(stateOf))
const doneCount = computed(() => queue.sessions.value.filter(s => s.status === 'complete').length)
const pendingCount = computed(() => queue.sessions.value.length - doneCount.value)
const summary = computed(() => {
  const running = states.value.filter(s => s.live && !s.attention).length
  const attention = states.value.filter(s => s.attention).length
  const waiting = queue.sessions.value.filter(s => s.status === 'queued' || s.status === 'stopped').length
  return [
    running && `${running} в работе`,
    attention && `${attention} ждёт вас`,
    waiting && `${waiting} в очереди`,
    doneCount.value && `${doneCount.value} готово`,
  ].filter(Boolean).join(' · ')
})
const statusText = computed(() => status.value === 'idle' && !stages.value.length ? 'Пусто' : queueStatusLabel(status.value))
const statusTone = computed(() => ({ running: 'open', paused: 'progress', finished: 'done', failed: 'danger' } as Record<string, string>)[status.value] ?? 'neutral')

async function stop() {
  const ok = await app.confirm('Работающие агенты будут остановлены. Выполненные шаги останутся выполненными, остальные можно будет запустить снова.', { title: 'Остановить очередь?', confirmLabel: 'Остановить' })
  if (ok) await queue.stop()
}

// "Продолжить" only picks up an interrupted run; anything else is a new run.
const resumable = computed(() => (status.value === 'stopped' || status.value === 'failed')
  && queue.sessions.value.some(s => s.status === 'stopped' || s.status === 'complete'))

const history = computed(() => queue.history.value)
const showHistory = ref(false)
function runsWord(n: number) {
  const tens = n % 100, ones = n % 10
  return tens >= 11 && tens <= 14 ? 'запусков' : ones === 1 ? 'запуск' : ones >= 2 && ones <= 4 ? 'запуска' : 'запусков'
}
const formatDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

const queueMenu = computed<MenuItem[]>(() => [
  ...(stages.value.length ? [
    { label: 'Убрать выполненные', hint: 'Убрать из очереди шаги, которые уже готовы', disabled: !doneCount.value, action: () => queue.clearFinished() },
    { label: 'Очистить очередь', danger: true, action: async () => {
      if (await app.confirm('Убрать из очереди все этапы? План и выполненные шаги не изменятся.', { title: 'Очистить очередь?', confirmLabel: 'Очистить' })) await queue.clearAll()
    } },
  ] : []),
  ...(history.value.length ? [{ label: 'Очистить историю', hint: 'Забыть предыдущие запуски. Чаты агентов останутся во вкладке агентов', action: () => queue.clearHistory() }] : []),
])

function stageMenu(stage: QueueStage): MenuItem[] {
  const others = stages.value.map((st, i) => ({ st, i })).filter(({ st }) => st.id !== stage.id && !isFinished(st))
  return [
    ...(others.length ? [{ heading: 'Объединить с этапом' }] : []),
    ...others.map(({ st, i }) => ({
      label: `Этапом ${i + 1}`,
      hint: 'Шаги обоих этапов выполнятся одновременно, на месте этапа ' + (i + 1),
      action: () => queue.mergeStages(stage.id, st.id),
    })),
    ...(others.length ? [{ separator: true }] : []),
    { label: 'Удалить этап', danger: true, action: () => queue.removeStage(stage.id) },
  ]
}

// ── Drag & drop: onto a stage = run in parallel with it, onto a gap = its own stage ──
const dragId = ref<string | null>(null)
const overStage = ref<string | null>(null)
const overGap = ref<number | null>(null)
function endDrag() { dragId.value = null; overStage.value = null; overGap.value = null }
function drop(to: { stageId: string } | { index: number }) {
  const id = dragId.value
  endDrag()
  if (!id) return
  const from = stages.value.find(st => st.sessions.some(s => s.id === id))
  if ('stageId' in to && from?.id === to.stageId) return
  void queue.moveSession(id, to)
}
</script>

<style scoped>
.queue { display: flex; flex-direction: column; gap: 10px; }
.queue-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-height: var(--size-sm); }
.queue-heading { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.queue-summary { font-size: 12px; color: var(--text-muted); }
.queue-controls { display: flex; align-items: center; gap: 6px; }

.banner { font-size: 12px; line-height: 1.45; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg2); color: var(--text-muted); }
.banner.warn { border-color: var(--warning); background: var(--warning-soft); color: var(--warning-text); }
.banner.subtle { border-style: dashed; }
.queue-hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.45; margin-top: -2px; }
.queue-empty { font-size: 12.5px; color: var(--text-muted); padding: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; line-height: 1.5; }

.stages { display: flex; flex-direction: column; gap: 8px; }
.stages.dragging { gap: 4px; }
.stage { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-left: 3px solid var(--stage-color); border-radius: var(--radius); background: var(--bg); transition: border-color 0.12s, background 0.12s; }
.stage.current { border-color: var(--stage-color); box-shadow: 0 0 0 1px var(--stage-color); }
.stage.finished { opacity: 0.75; }
.stage.over { border-color: var(--blue-hover); background: var(--blue-soft); }
.stage-head { display: flex; align-items: center; gap: 8px; padding: 0 2px; min-height: var(--size-xs); }
.stage-num { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--stage-color); text-transform: uppercase; letter-spacing: 0.4px; }
.stage-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--stage-color); }

.history { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; border-top: 1px solid var(--border); }
.history-toggle { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 4px 2px; background: none; border: none; color: var(--text-muted); font-size: 12px; font-family: inherit; cursor: pointer; }
.history-toggle:hover { color: var(--text); }
.history-toggle svg { width: 14px; height: 14px; transition: transform 0.15s; }
.history-toggle svg.open { transform: rotate(90deg); }
.history-runs { display: flex; flex-direction: column; gap: 12px; }
.history-run { display: flex; flex-direction: column; gap: 4px; }
.history-date { font-size: 11px; color: var(--text-faint); }
.history-session { opacity: 0.8; }
.stage-parallel { font-size: 11px; color: var(--text-muted); }
.stage-current { font-size: 11px; color: var(--blue-hover); font-weight: 600; }
.spacer { flex: 1; }
.stage-sessions { display: flex; flex-direction: column; gap: 6px; }

.pause-toggle { font-size: 11px; font-family: inherit; padding: 2px 8px; border-radius: var(--radius-pill); border: 1px dashed var(--border-strong); background: none; color: var(--text-faint); cursor: pointer; white-space: nowrap; }
.pause-toggle:hover { border-color: var(--warning); color: var(--warning-text); }
.pause-toggle.on { border-style: solid; border-color: var(--warning); color: var(--warning-text); background: var(--warning-soft); }
.pause-toggle.static { cursor: default; }

.gap-drop { font-size: 11px; color: var(--text-faint); text-align: center; padding: 6px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); }
.gap-drop.over { border-color: var(--blue-hover); color: var(--blue-hover); background: var(--blue-soft); }
</style>
