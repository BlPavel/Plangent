<template>
  <div v-if="session" class="detail">
    <header class="detail-head">
      <div class="detail-title">
        <div class="detail-line">
          <span class="stage">{{ stageNumber > 0 ? `Этап ${stageNumber}` : 'Предыдущий запуск' }}</span>
          <strong>{{ agentName }}</strong>
          <code class="points">{{ pointsText }}</code>
          <span class="status-badge" :class="state.tone">{{ state.label }}</span>
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

    <nav v-if="session.reviewSessionId" class="detail-tabs">
      <button type="button" class="tab" :class="{ active: tab === 'chat' }" @click="tab = 'chat'">Исполнитель</button>
      <button type="button" class="tab" :class="{ active: tab === 'review' }" @click="tab = 'review'">Ревью · круг {{ session.reviewRound ?? 1 }}</button>
    </nav>
    <div v-if="tab === 'review' && findings.length" class="findings">
      <span v-for="f in findings" :key="f.id" class="finding" :class="f.severity"><code>{{ f.file }}:{{ f.line }}</code> {{ f.message }}</span>
    </div>

    <ChatView v-if="chatId" :key="chatId" class="chat" :session-id="chatId" />
    <div v-else class="empty-state small">
      {{ session.status === 'complete' ? 'Шаг отмечен выполненным без агента.' : 'Шаг ещё не запускался. Здесь появится чат агента, когда очередь до него дойдёт.' }}
    </div>
  </div>
  <div v-else class="empty-state">Выберите шаг в очереди, чтобы увидеть работу агента</div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import AnalysisLinks from './AnalysisLinks.vue'
import { api } from '@core/api'
import type { Agent, OrchestratorQueueSession, PlanStep } from '@core/models'
import { ChatView, useChatStore } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu from '@shared/ui/AppMenu.vue'
import { TaskQueueKey, liveSessionMenu } from '../composables/useTaskQueue'
import { pointsLabel, sessionState } from '../utils/queue-status'

interface Finding { id: string; file: string; line: number; severity: 'low' | 'medium' | 'high' | 'critical'; message: string }

const props = defineProps<{ session?: OrchestratorQueueSession; stageNumber: number; agents: Agent[]; steps: PlanStep[] }>()

const queue = inject(TaskQueueKey)!
const chatStore = useChatStore()
const tab = ref<'chat' | 'review'>('chat')
const findings = ref<Finding[]>([])

const chat = (id?: string) => id ? chatStore.sessions.find(c => c.id === id) : undefined
const state = computed(() => sessionState(props.session!, chat(props.session?.sessionId), chat(props.session?.reviewSessionId)))
const agentName = computed(() => props.agents.find(a => a.id === props.session?.agentId)?.name ?? props.session?.agentId)
const pointsText = computed(() => pointsLabel(props.session?.points ?? []))
const sessionSteps = computed(() => (props.session?.points ?? []).map(p => props.steps.find(s => s.id === p)).filter((s): s is PlanStep => !!s))
const menu = computed(() => liveSessionMenu(queue, props.session!))
const chatId = computed(() => tab.value === 'review' && props.session?.reviewSessionId ? props.session.reviewSessionId : props.session?.sessionId)

// A new review round, or a question from the reviewer, brings the review tab forward.
watch(() => props.session?.id, () => { tab.value = props.session?.status === 'reviewing' && props.session.reviewSessionId ? 'review' : 'chat' })
watch(() => props.session?.reviewSessionId, id => { if (id) tab.value = 'review' })
watch([tab, () => props.session?.reviewSessionId], async ([t, id]) => {
  findings.value = t === 'review' && id ? await api.get<Finding[]>(`/agent-sessions/${id}/findings`).catch(() => []) : []
}, { immediate: true })
</script>

<style scoped>
.detail { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.detail-head { display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.detail-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.detail-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.stage { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
.points { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-muted); }
.detail-steps { list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-muted); max-height: 84px; overflow-y: auto; }
.detail-steps code { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-faint); margin-right: 4px; }
.detail-steps li.done { text-decoration: line-through; text-decoration-color: var(--text-faint); }
.detail-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.detail-tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--border); }
.tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); padding: 8px 10px; margin-bottom: -1px; cursor: pointer; font-size: 12.5px; font-family: inherit; font-weight: 500; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--blue); }

.findings { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--border); max-height: 120px; overflow: auto; }
.finding { font-size: 11.5px; padding: 3px 8px; border-radius: var(--radius-sm); border-left: 3px solid var(--border-strong); background: var(--bg2); }
.finding code { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; color: var(--text-muted); margin-right: 6px; }
.finding.medium { border-color: var(--warning); }
.finding.high { border-color: var(--danger-hover); }
.finding.critical { border-color: var(--danger); }

.chat { flex: 1; min-height: 0; }
.empty-state.small { flex: 1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
