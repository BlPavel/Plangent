<template>
  <div class="chats">
    <aside>
      <select v-model="agentId"><option v-for="agent in agents.agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option></select>
      <select v-if="models.length" v-model="model"><option value="">Модель по умолчанию</option><option v-for="m in models" :key="m">{{ m }}</option></select>
      <button class="btn btn-primary" :disabled="!agentId || creating" @click="create">+ Новый чат</button>
      <div v-if="error" class="error">{{ error }}</div>
      <button v-for="session in sessions" :key="session.id" class="chat-row" :class="{ active: selected === session.id }" @click="selected = session.id" @dblclick="renameId = session.id; title = session.title">
        <strong>{{ session.title }}</strong><small>{{ statusLabel(session.status) }}</small>
      </button>
    </aside>
    <main><ChatView v-if="selected" :key="selected" :session-id="selected" @session="selected = $event" /><div v-else class="empty-state">Создайте чат с агентом</div></main>
    <AppModal :model-value="!!renameId" title="Название чата" @update:model-value="renameId = ''" @confirm="rename"><FormField v-model="title" label="Название" /></AppModal>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '@core/api'
import { useAgentsStore } from '@features/agents'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import ChatView from './ChatView.vue'
import { useChatStore, statusLabel, type ChatSession } from '../stores/sessions'
const props = defineProps<{ projectId: string; defaultAgentId?: string | null }>()
const store = useChatStore(), agents = useAgentsStore()
const agentId = ref(''), model = ref(''), selected = ref(''), error = ref(''), creating = ref(false), renameId = ref(''), title = ref('')
const sessions = computed(() => store.sessions.filter(s => s.project_id === props.projectId && s.role === 'chat'))
const models = computed(() => agents.agents.find(a => a.id === agentId.value)?.model_options ?? [])
watch(() => props.projectId, () => { selected.value = ''; agentId.value = props.defaultAgentId || agents.agents[0]?.id || ''; void store.connect() }, { immediate: true })
watch(agentId, () => { model.value = '' })
async function create() { creating.value = true; try { const s = await api.post<ChatSession>('/agent-sessions', { project_id: props.projectId, agent_id: agentId.value, model: model.value }); store.put(s); selected.value = s.id } catch (e) { error.value = String(e) } finally { creating.value = false } }
async function rename() { store.put(await api.patch<ChatSession>(`/agent-sessions/${renameId.value}`, { title: title.value })); renameId.value = '' }
</script>
<style scoped>
.chats{display:flex;height:100%;min-height:0}aside{width:230px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding:12px;border-right:1px solid var(--border);overflow:auto}main{flex:1;min-width:0}.chat-row{text-align:left;background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:10px;cursor:pointer}.chat-row strong,.chat-row small{display:block;overflow:hidden;text-overflow:ellipsis}.chat-row small{margin-top:6px;color:var(--text-muted)}.active{border-color:var(--blue)}select{background:var(--bg2);color:var(--text);padding:8px;border:1px solid var(--border)}
</style>
