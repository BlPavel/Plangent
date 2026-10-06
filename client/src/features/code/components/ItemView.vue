<template>
  <ItemComposer
    v-if="editing" :where="where" :general="item.scope === 'general'" :initial-kind="item.kind" :initial-text="item.text" :initial-refs="item.refs" :busy="busy" :error="error"
    @save="save" @cancel="editing = false"
  />
  <ItemCard
    v-else :item="item" :thread="thread" :state="state" :read-only="readOnly" :show-location="showLocation" :busy="busy"
    :agent-busy="agent.busy" :working="working" :permissions="working ? agent.permissions : []"
    @edit="editing = true" @remove="remove" @general="general" @goto="emit('goto')" @open-ref="emit('open-ref', $event)"
    @send-now="agent.send([item.id])" @reply="reply" @remove-message="removeMessage" @close="close"
    @permission="(permission, option) => agent.answerPermission(permission, option)" @show-change="(round, file) => emit('show-change', round, file)"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'
import { useReviewAgentStore } from '../stores/review-agent'
import type { CodeReviewItem } from '../types'
import { threadState } from '../utils/thread'
import ItemCard from './ItemCard.vue'
import ItemComposer from './ItemComposer.vue'

/** A review item with its thread, wired to the review store and the review's agent. */
const props = defineProps<{ item: CodeReviewItem; readOnly?: boolean; showLocation?: boolean }>()
const emit = defineEmits<{ goto: []; 'open-ref': [ref: string]; 'show-change': [roundId: string, file?: string] }>()
const store = useCodeStore()
const agent = useReviewAgentStore()
const app = useAppStore()
const editing = ref(false)
const busy = ref(false)
const error = ref('')

const thread = computed(() => store.messages.filter(m => m.item_id === props.item.id))
const state = computed(() => threadState(props.item, store.messages))
const working = computed(() => state.value === 'agent' && agent.busy && agent.focusItem === props.item.id)
const where = computed(() => {
  const { scope, file, line_start, line_end, side } = props.item
  if (scope === 'general') return 'Общее замечание'
  if (scope === 'file') return file ?? ''
  return `${file}:${line_start}${line_end && line_end !== line_start ? '–' + line_end : ''}${side === 'old' ? ' (удалённые строки)' : ''}`
})

async function run(action: () => Promise<unknown>, fallback: string) {
  busy.value = true; error.value = ''
  try { await action(); return true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : fallback; app.toast(error.value, 'error'); return false }
  finally { busy.value = false }
}
async function save(value: { kind: 'fix' | 'question'; text: string; refs: string[] }) {
  const patch = value
  if (await run(() => store.updateDraft(props.item.review_id, props.item.id, patch), 'Не удалось сохранить')) editing.value = false
}
const remove = () => run(() => store.removeItem(props.item.review_id, props.item.id), 'Не удалось удалить')
const general = () => run(() => store.makeGeneral(props.item.review_id, props.item.id), 'Не удалось превратить в общий')
const reply = (text: string) =>
  run(() => store.addMessage(props.item.review_id, props.item.id, { kind: 'text', text }), 'Не удалось сохранить ответ')
const removeMessage = (id: string) => run(() => store.removeMessage(props.item.review_id, props.item.id, id), 'Не удалось убрать ответ')
const close = (resolution: 'accept' | 'answered' | 'reject' | 'reopen') => run(() => store.closeItem(props.item.review_id, props.item.id, resolution), 'Не удалось изменить статус')
</script>
