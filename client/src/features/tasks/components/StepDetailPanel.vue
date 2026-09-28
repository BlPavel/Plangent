<template>
  <div v-if="session?.sessionId" class="detail">
    <nav><button class="btn" @click="tab = 'chat'">Шаг</button><button v-if="session.reviewSessionId" class="btn" @click="tab = 'review'">Ревью · {{ session.reviewRound }}</button></nav>
    <div v-if="tab === 'review' && findingsList.length" class="findings-summary">
      <span v-for="f in findingsList" :key="f.id" class="finding-chip" :class="f.severity"><code>{{ f.file }}:{{ f.line }}</code> {{ f.message }}</span>
    </div>
    <ChatView class="chat" :session-id="tab === 'review' && session.reviewSessionId ? session.reviewSessionId : session.sessionId" />
    <footer><button v-if="session.status === 'ready_for_execution'" class="btn btn-primary" @click="action('execute')">Выполнить</button><button class="btn" @click="action('advance')">✓ Принять шаг</button><button class="btn" @click="action('restart')">↻ Перезапуск</button><button class="btn" @click="action('cancel')">Отменить</button></footer>
    <p v-if="error">{{ error }}</p>
  </div>
  <div v-else class="empty-state">Выберите запущенный шаг</div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChatView } from '@features/agent-chat'
import { api } from '@core/api'
import type { OrchestratorQueueSession } from '@core/models'
interface Finding { id: string; file: string; line: number; severity: 'low' | 'medium' | 'high' | 'critical'; message: string }
const props = defineProps<{ session?: OrchestratorQueueSession; projectId: string; taskId: string }>()
const emit = defineEmits<{ changed: [] }>()
const tab = ref('chat'), error = ref('')
const findingsList = ref<Finding[]>([])
watch(() => props.session?.id, () => { tab.value = 'chat' })
watch([tab, () => props.session?.reviewSessionId], async ([t, reviewSessionId]) => {
  findingsList.value = t === 'review' && reviewSessionId ? await api.get<Finding[]>(`/agent-sessions/${reviewSessionId}/findings`).catch(() => []) : []
}, { immediate: true })
async function action(name: string) { try { await api.post(`/projects/${props.projectId}/tasks/${props.taskId}/sessions/${props.session!.id}/${name}`); emit('changed') } catch (e) { error.value = String(e) } }
</script>
<style scoped>
.detail{height:100%;display:flex;flex-direction:column;min-height:0}.chat{flex:1;min-height:0}nav,footer{display:flex;gap:6px;padding:6px;flex-wrap:wrap}
.findings-summary{display:flex;flex-direction:column;gap:4px;padding:6px;border-bottom:1px solid var(--border);max-height:120px;overflow:auto}
.finding-chip{font-size:11px;padding:3px 8px;border-radius:6px;border-left:3px solid var(--border-strong);background:var(--bg2)}
.finding-chip code{font-family:'Cascadia Code','JetBrains Mono',monospace;color:var(--text-muted);margin-right:6px}
.finding-chip.medium{border-color:#d29922}.finding-chip.high{border-color:var(--danger-hover)}.finding-chip.critical{border-color:var(--danger)}
</style>
