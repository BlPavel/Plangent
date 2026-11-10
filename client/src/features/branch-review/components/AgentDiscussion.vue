<template>
  <div class="ad">
    <div v-for="message in messages" :key="message.id" class="ad-msg" :class="[message.author, { queued: isQueued(message) }]">
      <small>{{ message.author === 'agent' ? 'Агент' : 'Вы' }}<template v-if="KINDS[message.kind]"> · {{ KINDS[message.kind] }}</template><template v-if="isQueued(message)"> · ещё не отправлено</template></small>
      <MessageMarkdown :text="message.text" />
      <div v-if="isQueued(message)" class="ad-actions">
        <AppButton variant="link" size="xs" type="button" :disabled="busy" title="Отправить агенту только этот разговор" @click="sendNow">Отправить сейчас</AppButton>
        <AppButton variant="danger-link" size="xs" type="button" :disabled="busy" @click="remove(message.id)">Убрать</AppButton>
      </div>
    </div>
    <p v-if="stage === 'waiting'" class="ad-note">Агент отвечает…</p>
    <form v-if="composing" class="ad-form" @submit.prevent="submit" @keydown.esc.stop.prevent="composing = false">
      <AppTextarea v-model="text" block rows="3" :placeholder="placeholder" spellcheck="false" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit" />
      <div class="ad-actions">
        <span class="ad-spacer" />
        <AppButton variant="subtle" size="xs" type="button" @click="composing = false">Отмена</AppButton>
        <AppButton variant="blue" size="xs" type="submit" :disabled="!text.trim() || busy">В очередь</AppButton>
      </div>
    </form>
    <div v-else class="ad-actions">
      <AppButton class="ad-act" variant="ghost" size="xs" type="button" :disabled="busy" :title="hint" @click="composing = true">{{ messages.length ? 'Ответить' : 'Спросить агента' }}</AppButton>
    </div>
  </div>
</template>
<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { useDraft } from '@core/composables/useDraft'
import { useAppStore } from '@core/stores/app'
import { MessageMarkdown } from '@shared/markdown'
import { errorText } from '@shared/utils/errorText'
import { ref } from 'vue'
import { branchReviewApi } from '../api'
import type { BranchQuestionMessage, Remark } from '../types'
import { useDiscussion } from '../composables/useDiscussion'

/**
 * The developer's conversation with the agent about a remark or a colleague's thread. What is written waits in the queue
 * (like the plan review's comments) and goes to the agent in one batch; the agent's answers appear here.
 */
const emit = defineEmits<{ queued: [] }>()
const props = withDefaults(defineProps<{ screenKey: string; scope: string; reviewId: string; remarkId?: string; threadId?: string; where?: string; place?: Pick<Remark, 'path' | 'side' | 'line'>; placeholder: string; hint: string }>(), { where: 'panel' })
const app = useAppStore()
const { screen, question, messages, stage } = useDiscussion(props.screenKey, () => ({ remarkId: props.remarkId, threadId: props.threadId }))
const composing = useDraft(() => `branch-review:${props.reviewId}:discuss:${props.remarkId ?? props.threadId}:${props.where}:open`, () => false)
const text = useDraft(() => `branch-review:${props.reviewId}:discuss:${props.remarkId ?? props.threadId}:${props.where}:text`, () => '')
const busy = ref(false)
const KINDS: Record<string, string> = { options: 'варианты', questions: 'уточняющие вопросы' }
const isQueued = (m: BranchQuestionMessage) => m.author === 'developer' && !m.sent

async function run(action: () => Promise<{ questions: typeof screen.questions; messages: typeof screen.messages; thread?: typeof screen.thread }>) {
  busy.value = true
  try {
    const value = await action()
    screen.questions = value.questions; screen.messages = value.messages
    if (value.thread) screen.thread = value.thread
    return true
  } catch (cause) { app.toast(errorText(cause), 'error'); return false }
  finally { busy.value = false }
}
async function submit() {
  const written = text.value.trim()
  if (!written || busy.value) return
  const place = props.place?.path ? { path: props.place.path, side: props.place.side, line: props.place.line } : {}
  const ok = await run(() => question.value
    ? branchReviewApi.reply(props.scope, props.reviewId, question.value.id, written)
    : branchReviewApi.addQuestion(props.scope, props.reviewId, { ...place, text: written, ...(props.remarkId ? { remark_id: props.remarkId } : { thread_id: props.threadId }) }))
  if (ok) { text.value = ''; composing.value = false; emit('queued') }
}
const remove = (id: string) => question.value && run(() => branchReviewApi.removeMessage(props.scope, props.reviewId, question.value!.id, id))
const sendNow = () => question.value && run(() => branchReviewApi.send(props.scope, props.reviewId, { question_ids: [question.value!.id] }))
</script>
<style scoped>
.ad { display: flex; flex-direction: column; gap: 6px; }
.ad-msg { display: flex; flex-direction: column; gap: 2px; padding: 5px 8px; border-left: 2px solid var(--text-faint); border-radius: var(--radius-sm); background: var(--bg); line-height: 1.5; }
.ad-msg.agent { border-left-color: var(--blue); }
.ad-msg.queued { border-left-style: dashed; opacity: 0.9; }
.ad-msg small { font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--text-muted); }
.ad-note { margin: 0; font-size: var(--fs-xs); color: var(--blue-hover); }
.ad-form { display: flex; flex-direction: column; gap: 6px; }
.ad-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.ad-spacer { flex: 1; }
.ad-act { min-width: 76px; }
</style>
