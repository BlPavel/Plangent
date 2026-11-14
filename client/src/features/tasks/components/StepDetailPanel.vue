<template>
  <div v-if="session" class="detail">
    <header class="detail-head">
      <div class="detail-title">
        <div class="detail-line">
          <span class="stage">{{ stageNumber > 0 ? `Этап ${stageNumber}` : 'Предыдущий запуск' }}</span>
          <strong>{{ agentName }}</strong>
          <code class="points">{{ pointsText }}</code>
          <AppBadge dot  :tone="state.tone">{{ state.label }}</AppBadge>
        </div>
        <ul class="detail-steps">
          <li v-for="s in sessionSteps" :key="s.id" :class="{ done: s.done }"><code>{{ s.id }}</code> <AnalysisLinks :text="s.text" /></li>
        </ul>
      </div>
      <div class="detail-actions">
        <AppButton v-if="session.status === 'ready_for_execution'" variant="primary" size="sm" @click="queue.sessionAction(session.id, 'execute')">Приступить к выполнению</AppButton>
        <AppMenu v-if="state.live" :items="menu" />
      </div>
    </header>

    <ChatView v-if="chatId" :key="chatId" class="chat" :session-id="chatId" :workspace-id="workspaceId" />
    <AppEmptyState small v-else >
      {{ emptyText }}
    </AppEmptyState>
  </div>
  <AppEmptyState v-else >Выберите шаг в очереди, чтобы увидеть работу агента</AppEmptyState>
</template>

<script setup lang="ts">
import AppEmptyState from '@shared/ui/AppEmptyState.vue'
import AppBadge from '@shared/ui/AppBadge.vue'
import { computed, inject } from 'vue'
import AnalysisLinks from './AnalysisLinks.vue'
import type { Agent, OrchestratorQueueSession, PlanStep } from '@contracts'
import { ChatView, useChatStore } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu from '@shared/ui/AppMenu.vue'
import { TaskQueueKey, liveSessionMenu } from '../composables/useTaskQueue'
import { pointsLabel, remarksLabel, sessionState } from '../utils/queue-status'


const props = defineProps<{ workspaceId?: string | null; session?: OrchestratorQueueSession; stageNumber: number; agents: Agent[]; steps: PlanStep[] }>()

const queue = inject(TaskQueueKey)!
const chatStore = useChatStore()

const chat = (id?: string) => id ? chatStore.sessions.find(c => c.id === id) : undefined
const state = computed(() => sessionState(props.session!, chat(props.session?.sessionId)))
const agentName = computed(() => props.agents.find(a => a.id === props.session?.agentId)?.name ?? props.session?.agentId)
const pointsText = computed(() => props.session?.kind === 'review' ? (props.session.status === 'complete' ? `Ревью: ${remarksLabel(props.session.remarks ?? 0)}` : 'Ревью') : pointsLabel(props.session?.points ?? []))
const sessionSteps = computed(() => (props.session?.points ?? []).map(p => props.steps.find(s => s.id === p)).filter((s): s is PlanStep => !!s))
const menu = computed(() => liveSessionMenu(queue, props.session!))
const chatId = computed(() => props.session?.sessionId)
const emptyText = computed(() => props.session?.kind === 'review'
  ? props.session.status === 'complete' ? 'Чат этого ревью недоступен. Замечания — в «Коде».' : 'Ревью ещё не запускалось. Здесь появится чат ревьюера, когда очередь до него дойдёт.'
  : props.session?.status === 'complete' ? 'Шаг отмечен выполненным без агента.' : 'Шаг ещё не запускался. Здесь появится чат агента, когда очередь до него дойдёт.')

</script>

<style scoped>
.detail { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.detail-head { display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.detail-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.detail-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--fs-md); }
.stage { font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.points { font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-muted); }
.detail-steps { list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-sm); color: var(--text-muted); max-height: 84px; overflow-y: auto; }
.detail-steps code { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint); margin-right: 4px; }
.detail-steps li.done { text-decoration: line-through; text-decoration-color: var(--text-faint); }
.detail-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.chat { flex: 1; min-height: 0; }
.empty-state.small { flex: 1; padding: 24px; text-align: center; color: var(--text-muted); font-size: var(--fs-md); }
</style>
