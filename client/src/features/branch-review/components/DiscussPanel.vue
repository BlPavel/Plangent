<template>
  <aside class="dp" aria-label="Вопросы агенту">
    <div class="dp-agent">
      <template v-if="session">
        <span class="dp-dot" :class="session.status" />
        <span class="dp-name" :title="session.title">{{ agentName }}</span>
        <span class="muted">{{ statusLabel(session.status) }}</span>
        <span class="dp-spacer" />
        <AppButton v-if="busy" size="xs" variant="ghost" :disabled="stopping" title="Прервать агента; вопросы без ответа вернутся в очередь" @click="stop">{{ stopping ? 'Останавливаю…' : 'Стоп' }}</AppButton>
      </template>
      <template v-else><strong>Вопросы агенту</strong><span class="muted">код не меняется</span></template>
    </div>

    <NewChatPanel
      v-if="setup" compact class="dp-setup" :project-id="projectId" :default-agent-id="defaultAgentId" title="Агент" fixed-policy="read-only"
      :text="`Уйдёт ${setupCount} ${plural(setupCount)}. Агент только читает код и отвечает в карточках.${screen.thread ? ' Ветка обновилась: начнётся новый разговор.' : ''}`"
      initial-text="" :send-label="`Отправить ${setupCount}`" :busy="sending" @start="send(setup.ids, $event)"
    >
      <template #actions><button type="button" class="dp-link" @click="setup = null">Отмена</button></template>
    </NewChatPanel>
    <div v-else class="dp-actions">
      <AppButton size="xs" variant="ghost" :disabled="composing" title="Вопрос не к строке, а ко всей ветке" @click="composing = true">+ Общий</AppButton>
      <AppButton
        size="xs" variant="blue" :disabled="!pending || busy || sending"
        :title="busy ? 'Агент отвечает: дождитесь конца ответа' : pending ? 'Отправить агенту новые вопросы и ваши ответы в обсуждениях' : 'Нечего отправлять'"
        @click="sendClick(null)"
      >{{ sending ? 'Отправка…' : `Отправить${pending ? ' ' + pending : ''}` }}</AppButton>
    </div>
    <p v-if="error" role="alert" class="dp-error">{{ error }}</p>

    <div class="dp-list">
      <form v-if="composing" class="dp-new" @submit.prevent="addGeneral">
        <div class="dp-new-head">Общий вопрос по ветке</div>
        <textarea v-model="generalText" class="control dp-text" rows="3" placeholder="Вопрос агенту про всю ветку. Ctrl+Enter — сохранить" spellcheck="false" @keydown.ctrl.enter.prevent="addGeneral" @keydown.meta.enter.prevent="addGeneral" />
        <div class="dp-new-bar">
          <button type="button" class="btn btn-subtle btn-xs" @click="composing = false">Отмена</button>
          <button class="btn btn-blue btn-xs" :disabled="!generalText.trim()">Сохранить</button>
        </div>
      </form>
      <div v-if="!screen.questions.length && !composing" class="dp-empty">
        Выделите строку в diff и задайте вопрос или добавьте общий. Вопросы копятся, агенту ничего не уходит, пока вы не нажмёте «Отправить».
        Дальше переписывайтесь с агентом прямо в карточках: ответы тоже копятся и уходят одной отправкой.
      </div>
      <BranchQuestionCard
        v-for="q in screen.questions" :key="q.id" :question="q" :messages="thread(q.id)" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :agent-busy="busy"
        @goto="emit('goto', q)" @send-now="sendClick([q.id])"
      />
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { NewChatPanel, statusLabel, useChatStore, type NewChatRequest } from '@features/agent-chat'
import { useAgentsStore } from '@features/agents'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchQuestion } from '../types'
import { useBranchReviewStore } from '../stores/review'
import BranchQuestionCard from './BranchQuestionCard.vue'

const props = defineProps<{ screenKey: string; scope: string; projectId: string; reviewId: string; head: string; defaultAgentId?: string | null }>()
const emit = defineEmits<{ goto: [question: BranchQuestion] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const chats = useChatStore(), agents = useAgentsStore()
const sending = ref(false), stopping = ref(false), error = ref(''), composing = ref(false), generalText = ref('')
const setup = ref<{ ids: string[] | null } | null>(null)
void chats.connect()

/** The session of this review's current head; after new commits the agent has to be chosen again. */
const active = computed(() => screen.thread && screen.thread.head === props.head ? screen.thread.session_id : '')
const session = computed(() => chats.sessions.find(s => s.id === active.value) ?? null)
watch(active, id => { if (id && !chats.snapshots[id]) void chats.load(id).catch(() => undefined) }, { immediate: true })
const busy = computed(() => ['starting', 'thinking'].includes(session.value?.status ?? ''))
const agentName = computed(() => agents.agents.find(a => a.id === session.value?.agent_id)?.name ?? 'Агент')
const queuedIds = computed(() => new Set(screen.messages.filter(m => m.author === 'developer' && !m.sent).map(m => m.question_id)))
const pending = computed(() => queuedIds.value.size)
const setupCount = computed(() => setup.value?.ids ? setup.value.ids.filter(id => queuedIds.value.has(id)).length : pending.value)
const plural = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'вопрос' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'вопроса' : 'вопросов'
const thread = (id: string) => screen.messages.filter(m => m.question_id === id)

/** Without an agent for this head the first send asks who should answer. */
function sendClick(ids: string[] | null) {
  error.value = ''
  if (!active.value) { setup.value = { ids }; return }
  void send(ids)
}
async function send(ids: string[] | null, request?: NewChatRequest) {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    const agent = request && { agent_id: request.agent_id, model: request.model, mode: request.mode, config: request.config }
    const result = await branchReviewApi.send(props.scope, props.reviewId, { agent, ...(ids ? { question_ids: ids } : {}) })
    screen.questions = result.questions; screen.messages = result.messages; screen.thread = result.thread
    setup.value = null
  } catch (cause) { error.value = errorText(cause) } finally { sending.value = false }
}
async function stop() {
  stopping.value = true
  try { const result = await branchReviewApi.stop(props.scope, props.reviewId); screen.questions = result.questions; screen.messages = result.messages }
  catch (cause) { error.value = errorText(cause) } finally { stopping.value = false }
}
async function addGeneral() {
  const text = generalText.value.trim()
  if (!text) return
  try {
    const result = await branchReviewApi.addQuestion(props.scope, props.reviewId, { text })
    screen.questions = result.questions; screen.messages = result.messages
    generalText.value = ''; composing.value = false
  } catch (cause) { error.value = errorText(cause) }
}
</script>
<style scoped>
.dp { width: 400px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); font-size: 12px; }
.dp-agent, .dp-actions { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex-shrink: 0; }
.dp-agent { border-bottom: 1px solid var(--border); }
.dp-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--text-faint); }
.dp-dot.thinking, .dp-dot.starting { background: var(--blue-hover); }
.dp-dot.waiting { background: var(--warning-text); }
.dp-spacer { flex: 1; }
.dp-setup { flex: none; height: auto; border-bottom: 1px solid var(--border); }
.dp-link { padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.dp-error { padding: 6px 10px; color: var(--danger-hover); overflow-wrap: anywhere; }
.dp-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; }
.dp-empty { padding: 8px 2px; color: var(--text-muted); line-height: 1.45; }
.dp-new { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.dp-new-head { font-weight: 600; color: var(--text-muted); }
.dp-text { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.dp-new-bar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
