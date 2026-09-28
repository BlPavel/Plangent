<template>
  <div class="execution">
    <section>
      <div class="queue-list">
        <div
          v-for="row in rows"
          :key="row.key"
          class="queue-item"
          :class="[row.queueSession?.status, { expanded: row.terminalSession && activeSessionId === row.terminalSession.id }]"
        >
          <div class="queue-row-main" @click="$emit('update:activeSessionId', row.queueSession?.sessionId ?? null)">
            <span class="queue-num">#{{ row.index }}</span>
            <span class="queue-agent">{{ row.agentName }}</span>
            <span class="queue-points">{{ row.pointsLabel }}</span>
            <span class="mode-badge" :class="row.queueSession?.queueMode">{{ row.modeLabel }}</span>
            <span v-if="row.queueSession?.parallelGroup" class="parallel-badge">одновременно</span>
            <span v-if="row.queueSession?.reason">{{ row.queueSession.reason }}</span>
            <select v-if="row.queueSession?.status === 'queued'" v-model="row.queueSession.reviewerId" @click.stop>
              <option :value="undefined">Без ревью</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">Ревью: {{ a.name }}</option>
            </select>
            <select
              v-if="row.queueSession?.status === 'queued'"
              v-model="row.queueSession.permissionPolicy"
              title="Как отвечать на запросы разрешений агента. Опасные команды (rm -rf, git push --force, список проекта) всегда спрашиваются."
              @click.stop
            >
              <option value="allow-all">Автономно</option>
              <option value="allow-edits">Только правки</option>
              <option value="ask">Спрашивать всё</option>
            </select>
            <span v-else-if="row.queueSession?.permissionPolicy === 'allow-edits' || row.queueSession?.permissionPolicy === 'ask'" class="policy-badge">
              {{ row.queueSession.permissionPolicy === 'ask' ? 'спрашивает всё' : 'только правки' }}
            </span>
            <span class="queue-status-chip" :class="row.statusClass">{{ row.statusLabel }}</span>
            <AppButton
              v-if="row.canAttach && (!row.terminalSession || activeSessionId !== row.terminalSession.id)"
              variant="ghost"
              size="sm"
              @click.stop="$emit('attach', row.runId!)"
            >Подключиться</AppButton>
            <AppButton
              v-if="row.terminalSession && activeSessionId === row.terminalSession.id"
              class="terminal-toggle-btn"
              variant="ghost"
              size="sm"
              @click.stop="$emit('update:activeSessionId', null)"
            >Свернуть</AppButton>
            <button
              v-if="row.queueSession?.queueMode === 'review_first' && row.queueSession?.status !== 'queued' && row.queueSession?.status !== 'running' && row.queueSession?.status !== 'complete' && row.queueSession?.status !== 'failed'"
              class="btn btn-primary btn-sm"
              :disabled="!row.canExecuteReview"
              :title="row.executeTitle"
              @click.stop="$emit('executeReview', row.queueSession.id)"
            >Выполнить</button>
            <AppButton
              v-if="row.terminalSession"
              variant="danger-ghost"
              size="sm"
              @click.stop="$emit('kill', row.terminalSession.id)"
            >Завершить</AppButton>
            <button
              v-if="row.queueSession?.status === 'queued'"
              class="pause-pill"
              :class="{ active: row.queueSession.pauseAfter }"
              @click.stop="row.queueSession.pauseAfter = !row.queueSession.pauseAfter"
              :title="row.queueSession.pauseAfter ? 'Очередь остановится после этой сессии — нажмите, чтобы убрать паузу' : 'Остановить очередь после этой сессии для ревью'"
            >⏸ пауза после</button>
            <span v-else-if="row.queueSession?.pauseAfter" class="pause-badge" title="Очередь остановится после этой сессии">⏸ ревью</span>
            <AppButton
              v-if="row.queueSession?.status === 'queued'"
              variant="danger-ghost"
              size="xs"
              @click.stop="$emit('remove', row.queueIndex!)"
            >✕</AppButton>
          </div>
        </div>
      </div>

      <div v-if="queuePaused" class="queue-paused-banner">
        <span>{{ readyForExecutionCount ? 'Очередь на паузе — обсудите шаги или запустите выполнение.' : '⏸ Очередь на паузе — ревью перед следующим шагом.' }}</span>
        <AppButton v-if="!readyForExecutionCount" variant="primary" size="sm" @click="$emit('resumeQueue')">▶ Продолжить очередь</AppButton>
      </div>

      <div class="queue-actions" v-if="!executing && hasQueuedSessions && !taskDone">
        <AppButton variant="primary" :disabled="executing || !hasQueuedSessions" @click="$emit('runQueue')">
          {{ executing ? 'Выполняется...' : '▶ Запустить очередь' }}
        </AppButton>
        <AppButton variant="ghost" @click="$emit('clearQueued')">Очистить</AppButton>
      </div>
    </section>
    <aside><slot name="detail" /></aside>
  </div>
</template>
<script setup lang="ts">
import type { Agent, OrchestratorQueueSession, OrchestratorSessionStatus } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'

export interface ExecutionQueueRow {
  key: string
  index: number
  queueIndex: number
  queueSession: OrchestratorQueueSession
  terminalSession: { id: string; label: string; runId: string } | null
  agentName: string
  pointsLabel: string
  modeLabel: string
  statusClass: OrchestratorSessionStatus | 'thinking' | string
  statusLabel: string
  runId: string | null
  canAttach: boolean
  canExecuteReview: boolean
  executeTitle: string
}

defineProps<{
  rows: ExecutionQueueRow[]
  agents: Agent[]
  activeSessionId: string | null
  queuePaused: boolean
  readyForExecutionCount: number
  executing: boolean
  hasQueuedSessions: boolean
  taskDone: boolean
}>()
defineEmits<{
  'update:activeSessionId': [id: string | null]
  attach: [runId: string]
  executeReview: [sessionId: string]
  kill: [terminalSessionId: string]
  remove: [queueIndex: number]
  resumeQueue: []
  runQueue: []
  clearQueued: []
}>()
</script>
<style scoped>
.execution{display:grid;grid-template-columns:minmax(300px, 42%) minmax(0, 1fr);gap:12px;min-height:500px;height:65vh}
.execution section{overflow:auto;display:flex;flex-direction:column;gap:8px}
.execution aside{min-height:0;border:1px solid var(--border)}

.queue-list { display: flex; flex-direction: column; gap: 4px; }
.queue-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.queue-item.expanded { padding-bottom: 10px; }
.queue-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.queue-num { color: var(--text-muted); font-size: 11px; min-width: 20px; }
.queue-agent { font-weight: 600; }
.queue-points { color: var(--text-muted); font-family: monospace; font-size: 11px; flex: 1; }
.queue-status-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.queue-status-chip.running { color: #e3b341; border-color: #e3b341; }
.queue-status-chip.reviewing { color: #58a6ff; border-color: #58a6ff; }
.queue-status-chip.thinking { color: #e3b341; border-color: #e3b341; }
.queue-status-chip.ready_for_execution { color: var(--accent); border-color: var(--accent); }
.queue-status-chip.complete { color: var(--accent); border-color: var(--accent); }
.queue-status-chip.failed { color: var(--danger); border-color: var(--danger); }
.queue-status-chip.waiting_for_developer { color: #d29922; border-color: #d29922; }

.mode-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}
.mode-badge.review_first {
  color: #58a6ff;
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}
.parallel-badge {
  font-size: 10px;
  color: var(--blue);
  background: rgba(88,166,255,0.12);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}

.policy-badge {
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}
.pause-badge {
  font-size: 10px;
  color: #d29922;
  background: rgba(210, 153, 34, 0.12);
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}
.pause-pill {
  font-size: 10px;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px dashed var(--border);
  background: none;
  color: var(--text-muted);
  transition: all 0.1s;
}
.pause-pill:hover { border-color: #d29922; color: #d29922; }
.pause-pill.active {
  border-style: solid;
  border-color: #d29922;
  color: #d29922;
  background: rgba(210, 153, 34, 0.12);
}

.queue-paused-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: #d29922;
  background: rgba(210, 153, 34, 0.1);
  border: 1px solid #d29922;
  border-radius: var(--radius);
}

.queue-actions { display: flex; gap: 8px; align-items: center; }
.terminal-toggle-btn { min-width: 96px; }
</style>
