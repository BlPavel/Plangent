<template>
  <ItemComposer
    v-if="editing" :where="where" :general="item.scope === 'general'" :initial-kind="item.kind" :initial-text="item.text" :busy="busy" :error="error"
    @save="save" @cancel="editing = false"
  />
  <ItemCard
    v-else :item="item" :read-only="readOnly" :show-location="showLocation" :busy="busy" :agent-working="agentWorking" :selectable="selectable" :selected="selected"
    @toggle="emit('toggle')" @implement="emit('implement')" @edit="editing = true" @remove="remove" @general="general" @goto="emit('goto')" @discuss="emit('discuss')" @decide="decide" @open-ref="emit('open-ref', $event)"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'
import type { CodeReviewItem } from '../types'
import ItemCard from './ItemCard.vue'
import ItemComposer from './ItemComposer.vue'

const props = defineProps<{ item: CodeReviewItem; readOnly?: boolean; showLocation?: boolean; agentWorking?: boolean; selectable?: boolean; selected?: boolean }>()
const emit = defineEmits<{ goto: []; discuss: []; toggle: []; implement: []; 'open-ref': [ref: string] }>()
const store = useCodeStore()
const app = useAppStore()
const editing = ref(false)
const busy = ref(false)
const error = ref('')

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
  const patch = props.item.scope === 'general' ? value : { kind: value.kind, text: value.text }
  if (await run(() => store.updateDraft(props.item.review_id, props.item.id, patch), 'Не удалось сохранить')) editing.value = false
}
const remove = () => run(() => store.removeItem(props.item.review_id, props.item.id), 'Не удалось удалить')
const general = () => run(() => store.makeGeneral(props.item.review_id, props.item.id), 'Не удалось превратить в общий')
const decide = (decision: 'agree' | 'insist') => run(() => store.decideItem(props.item.review_id, props.item.id, decision), 'Не удалось применить решение')
</script>
