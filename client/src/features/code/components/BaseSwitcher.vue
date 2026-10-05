<template>
  <div v-if="options.length > 1" class="bs">
    <label class="bs-label" for="bs-select">Сравнивать</label>
    <select id="bs-select" class="bs-select" :value="selected" :disabled="locked" @change="pick(($event.target as HTMLSelectElement).value)">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCodeStore } from '../stores/code'

const store = useCodeStore()
/** An opened historical review is always «everything that entered it»: the base cannot be changed there. */
const locked = computed(() => !!store.openedReviewId)

const options = computed(() => {
  const list = [{ value: 'head', label: store.head ? `Относительно HEAD (${store.head.slice(0, 7)})` : 'Относительно HEAD' }]
  if (store.openedReviewId) return [{ value: 'review', label: 'Всё, что вошло в ревью' }]
  if (store.liveReview && store.repository) {
    const rounds = store.rounds
    if (rounds.length === 1) list.push({ value: 'agent:' + rounds[0].id, label: 'Изменения агента' })
    else for (const round of [...rounds].reverse()) list.push({ value: 'agent:' + round.id, label: `Изменения агента · после раунда ${round.n}` })
    list.push({ value: 'review', label: 'Всё, что вошло в ревью' })
  }
  return list
})
const selected = computed(() => {
  if (store.effectiveBase === 'review') return 'review'
  if (store.effectiveBase === 'head') return 'head'
  return 'agent:' + (store.baseRound ?? store.rounds[store.rounds.length - 1]?.id)
})
function pick(value: string) {
  if (value.startsWith('agent:')) void store.setBase('agent', value.slice('agent:'.length))
  else void store.setBase(value === 'review' ? 'review' : 'head')
}
</script>

<style scoped>
.bs { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 5px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.bs-label { color: var(--text-muted); white-space: nowrap; }
.bs-select { flex: 1; min-width: 0; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
</style>
