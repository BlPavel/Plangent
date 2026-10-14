<template>
  <form v-if="editing" class="qc-edit" @submit.prevent="saveEdit">
    <textarea v-model="draft" class="control qc-text" rows="3" spellcheck="false" @keydown.ctrl.enter.prevent="saveEdit" @keydown.meta.enter.prevent="saveEdit" />
    <div class="qc-bar">
      <button type="button" class="btn btn-subtle btn-xs" @click="editing = false">Отмена</button>
      <button class="btn btn-blue btn-xs" :disabled="!draft.trim() || busy">Сохранить</button>
    </div>
  </form>
  <ItemCard
    v-else :item="item" :thread="thread" :state="state" show-location :busy="busy" :agent-busy="agentBusy" :working="state === 'agent' && agentBusy"
    @edit="startEdit" @remove="removeFirst" @goto="emit('goto')" @send-now="emit('send-now')"
    @reply="reply" @remove-message="removeMessage" @close="close"
  />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ItemCard, threadState, type CodeReviewItem, type CodeReviewMessage } from '@features/code'
import { useAppStore } from '@core/stores/app'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchQuestion, BranchQuestionMessage } from '../types'
import { useBranchReviewStore } from '../stores/review'

/** A question thread of the branch review drawn by the same card as the code review's items. */
const props = defineProps<{ question: BranchQuestion; messages: BranchQuestionMessage[]; screenKey: string; scope: string; reviewId: string; agentBusy?: boolean }>()
const emit = defineEmits<{ goto: []; 'send-now': [] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const app = useAppStore()
const busy = ref(false), editing = ref(false), draft = ref('')

const first = computed(() => props.messages[0])
const last = computed(() => props.messages.at(-1))
/** Card statuses: not sent yet → draft; with the agent → sent; the agent replied → answered. */
const status = computed<CodeReviewItem['status']>(() => !first.value?.sent ? 'draft' : last.value?.author === 'agent' ? 'answered' : 'sent')
const general = computed(() => !props.question.path)
const item = computed<CodeReviewItem>(() => ({
  id: props.question.id, review_id: props.reviewId, round_id: null, author: 'developer', scope: general.value ? 'general' : 'line',
  file: props.question.path || null, line_start: props.question.line || null, line_end: props.question.line || null, side: props.question.side,
  kind: 'question', text: first.value?.text ?? '', refs: [], code_snippet: '', status: status.value, answer: null, outdated: false,
  closed: props.question.closed, carried_from_item_id: null, created_at: props.question.created_at, updated_at: props.question.created_at,
}))
const thread = computed<CodeReviewMessage[]>(() => props.messages.slice(1).map(m => ({
  id: m.id, item_id: props.question.id, author: m.author, kind: m.kind as CodeReviewMessage['kind'], text: m.text, options: [], choice: null,
  files: [], round_id: null, sent: m.sent, created_at: m.created_at,
})))
const state = computed(() => threadState(item.value, thread.value))

async function run(action: () => Promise<{ questions: BranchQuestion[]; messages: BranchQuestionMessage[] }>) {
  busy.value = true
  try { const value = await action(); screen.questions = value.questions; screen.messages = value.messages; return true }
  catch (cause) { app.toast(errorText(cause), 'error'); return false }
  finally { busy.value = false }
}
function startEdit() { draft.value = first.value?.text ?? ''; editing.value = true }
async function saveEdit() {
  if (first.value && await run(() => branchReviewApi.editMessage(props.scope, props.reviewId, props.question.id, first.value.id, draft.value))) editing.value = false
}
const removeFirst = () => first.value && run(() => branchReviewApi.removeMessage(props.scope, props.reviewId, props.question.id, first.value.id))
const reply = (text: string) => run(() => branchReviewApi.reply(props.scope, props.reviewId, props.question.id, text))
const removeMessage = (id: string) => run(() => branchReviewApi.removeMessage(props.scope, props.reviewId, props.question.id, id))
const close = (resolution: string) => run(() => branchReviewApi.closeQuestion(props.scope, props.reviewId, props.question.id, resolution !== 'reopen'))
</script>
<style scoped>
.qc-edit { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.qc-text { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.qc-bar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
