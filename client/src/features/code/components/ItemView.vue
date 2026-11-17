<template>
  <ItemComposer :draft-key="`item-edit:${item.id}:${place}`"
    v-if="editing" :where="where" :general="item.scope === 'general'" :initial-kind="item.kind" :initial-text="item.text" :initial-refs="item.refs" :busy="busy" :error="error"
    @save="save" @cancel="editing = false"
  />
  <ItemCard
    v-else :draft-key="`code-review:${item.review_id}:item:${item.id}:${place}:text`" :item="item" :thread="thread" :state="state" :read-only="readOnly" :show-location="showLocation" :embedded="embedded" :busy="busy" :error="error"
    :decision="decision" :discussing="discussing" :working="working" :permissions="working ? agent.permissions : []"
    @stop-discussing="discussing = false" @edit="editing = true" @remove="remove" @general="general" @goto="emit('goto')" @open-ref="emit('open-ref', $event)"
    @reply="reply" @remove-message="removeMessage" @close="close"
    @permission="(permission, option) => agent.answerPermission(permission, option)"
  >
    <!-- A draft the review agent wrote: accept it (it goes out with «Отправить» to be fixed) or talk it over first, like a question. -->
    <template v-if="item.author === 'agent' && state === 'draft' && !item.outdated && !readOnly" #extra-end>
      <AppButton v-if="!accepted" class="it-act" size="xs" variant="primary" type="button" :disabled="busy" title="Согласны: пункт уйдёт агенту на исправление вместе с остальными по «Отправить»" @click="setAccepted(item, true)">Принять</AppButton>
      <AppButton v-else class="it-act" size="xs" variant="ghost" type="button" :disabled="busy" title="Вернуть пункт на ваше решение: он не уйдёт с «Отправить»" @click="setAccepted(item, false)">Отменить принятие</AppButton>
    </template>
    <template v-if="item.author === 'agent' && state === 'draft' && !item.outdated && !readOnly" #extra>
      <AppButton v-if="!accepted && !discussing" class="it-act" size="xs" variant="ghost" type="button" :disabled="busy" title="Сначала обсудить: напишите агенту, сообщение встанет в очередь и уйдёт по «Отправить», агент ответит в карточке" @click="discussing = true">Обсудить</AppButton>
    </template>
  </ItemCard>
</template>

<script setup lang="ts">
import { useDraft } from '@core/composables/useDraft'
import { useDraftsStore } from '@core/stores/drafts'
import { computed, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useCodeContext } from '../stores/context'
import { useReviewAgentStore } from '../stores/review-agent'
import type { CodeReviewItem } from '../types'
import { threadState } from '../utils/thread'
import AppButton from '@shared/ui/AppButton.vue'
import { isAccepted, setAccepted } from '../utils/accepted'
import ItemCard from './ItemCard.vue'
import ItemComposer from './ItemComposer.vue'

/** A review item with its thread, wired to the review store and the review's agent. */
const props = defineProps<{ item: CodeReviewItem; readOnly?: boolean; showLocation?: boolean; embedded?: boolean }>()
const emit = defineEmits<{ goto: []; 'open-ref': [ref: string]; 'show-change': [roundId: string, file?: string] }>()
const store = useCodeContext()
const agent = useReviewAgentStore()
/** The same item is drawn in the code and in the panel: editing and a typed reply belong to the copy where they were started. */
const place = computed(() => (props.embedded ? 'code' : props.showLocation ? 'panel' : 'notes'))
const app = useAppStore()
const editing = useDraft(() => `code-review:${props.item.review_id}:item:${props.item.id}:${place.value}:editing`, () => false)
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
  if (await run(() => store.updateDraft(props.item.review_id, props.item.id, patch), 'Не удалось сохранить')) { editing.value = false; useDraftsStore().clearPrefix(`code-review:${props.item.review_id}:composer:item-edit:${props.item.id}:`) }
}
const accepted = computed(() => isAccepted(props.item))
const decision = computed(() => props.item.author === 'agent' && state.value === 'draft' && !props.item.outdated ? (accepted.value ? 'accepted' : 'pending') : undefined)
/** Talking over the agent's draft: the reply box opens in the card, what is written queues like any reply and the thread goes on there. */
const discussing = useDraft(() => `code-review:${props.item.review_id}:item:${props.item.id}:${place.value}:discussing`, () => false)
const remove = () => run(() => store.removeItem(props.item.review_id, props.item.id), 'Не удалось удалить')
const general = () => run(() => store.makeGeneral(props.item.review_id, props.item.id), 'Не удалось превратить в общий')
const reply = async (text: string, complete: (success: boolean) => void, kind: 'text' | 'implement') => {
  const success = await run(() => store.addMessage(props.item.review_id, props.item.id, { kind, text }), 'Не удалось сохранить ответ')
  if (success) discussing.value = false
  complete(success)
}
const removeMessage = (id: string) => run(() => store.removeMessage(props.item.review_id, props.item.id, id), 'Не удалось убрать ответ')
const close = async (resolution: 'accept' | 'answered' | 'reject' | 'reopen', complete: (success: boolean) => void) => complete(await run(() => store.closeItem(props.item.review_id, props.item.id, resolution), 'Не удалось изменить статус'))
</script>
