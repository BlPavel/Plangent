<template>
  <form v-if="editing" class="qc-edit" @submit.prevent="saveEdit">
    <AppTextarea v-model="draft" block rows="3" spellcheck="false" @keydown.ctrl.enter.prevent="saveEdit" @keydown.meta.enter.prevent="saveEdit" />
    <div class="qc-bar">
      <AppButton variant="subtle" size="xs" type="button"  @click="editing = false; draft = ''">Отмена</AppButton>
      <AppButton variant="blue" size="xs" type="submit" :disabled="!draft.trim() || busy">Сохранить</AppButton>
    </div>
  </form>
  <div v-else class="qc">
    <ItemCard :draft-key="`branch-review:${reviewId}:question:${question.id}:reply`"
      :item="item" :thread="thread" :state="state" show-location no-implement kind-label="вопрос" :busy="busy" :agent-busy="agentBusy" :working="state === 'agent' && agentBusy"
      @edit="startEdit" @remove="removeFirst" @goto="emit('goto')"
      @reply="reply" @remove-message="removeMessage" @close="close"
    >
      <template v-if="lastAnswer" #extra>
        <AppButton class="qc-act" variant="ghost" size="xs" type="button" :disabled="busy" title="Сделать из ответа агента черновик замечания: вопрос исчезнет, замечание можно править" @click="emit('to-remark', lastAnswer.text)">В замечание</AppButton>
      </template>
    </ItemCard>
  </div>
</template>
<script setup lang="ts">
import AppTextarea from '@shared/ui/AppTextarea.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useDraft } from '@core/composables/useDraft'
import { computed, ref } from 'vue'
import { ItemCard, threadState, type CodeReviewItem, type CodeReviewMessage } from '@features/code'
import { useAppStore } from '@core/stores/app'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { BranchQuestion, BranchQuestionMessage } from '../types'
import { useBranchReviewStore } from '../stores/review'

/** A question thread of the branch review drawn by the same card as the code review's items. */
const props = defineProps<{ question: BranchQuestion; messages: BranchQuestionMessage[]; screenKey: string; scope: string; reviewId: string; agentBusy?: boolean }>()
const emit = defineEmits<{ goto: []; 'to-remark': [text: string] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const app = useAppStore()
const busy = ref(false), editing = useDraft(() => `branch-review:${props.reviewId}:question:${props.question.id}:editing`, () => false), draft = useDraft(() => `branch-review:${props.reviewId}:question:${props.question.id}:draft`, () => '')

const first = computed(() => props.messages[0])
const last = computed(() => props.messages.at(-1))
/** Card statuses: not sent yet → draft; with the agent → sent; the agent replied → answered. */
const status = computed<CodeReviewItem['status']>(() => !first.value?.sent ? 'draft' : last.value?.author === 'agent' ? 'answered' : 'sent')
const general = computed(() => !props.question.path)
const lastAnswer = computed(() => [...props.messages].reverse().find(m => m.author === 'agent'))
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
  if (first.value && await run(() => branchReviewApi.editMessage(props.scope, props.reviewId, props.question.id, first.value.id, draft.value))) { editing.value = false; draft.value = '' }
}
const removeFirst = () => first.value && run(() => branchReviewApi.removeMessage(props.scope, props.reviewId, props.question.id, first.value.id))
const reply = (text: string) => run(() => branchReviewApi.reply(props.scope, props.reviewId, props.question.id, text))
const removeMessage = (id: string) => run(() => branchReviewApi.removeMessage(props.scope, props.reviewId, props.question.id, id))
const close = (resolution: string) => run(() => branchReviewApi.closeQuestion(props.scope, props.reviewId, props.question.id, resolution !== 'reopen'))
</script>
<style scoped>
.qc { display: flex; flex-direction: column; gap: 2px; }
.qc-remark { align-self: flex-end; padding: 0 4px; font: inherit; font-size: var(--fs-sm); color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.qc-edit { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.qc-act { min-width: 76px; }
.qc-bar { display: flex; justify-content: flex-end; gap: 6px; }
</style>
