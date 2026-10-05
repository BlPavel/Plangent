<template>
  <div v-if="options.length > 1" class="bs">
    <span class="bs-label">Показать</span>
    <div class="bs-group" role="radiogroup" aria-label="Какие изменения показать">
      <button
        v-for="option in options" :key="option.value" type="button" role="radio" class="bs-option" :class="{ on: kind === option.value }"
        :aria-checked="kind === option.value" :disabled="locked" :title="option.hint" @click="pick(option.value)"
      >{{ option.label }}</button>
    </div>
    <select
      v-if="kind === 'agent' && store.rounds.length > 1" class="bs-round" :value="round" title="После какого раунда показать изменения агента"
      @change="store.setBase('agent', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="r in [...store.rounds].reverse()" :key="r.id" :value="r.id">после раунда {{ r.n }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCodeStore } from '../stores/code'

const store = useCodeStore()
/** An opened historical review is always «everything that entered it»: the base cannot be changed there. */
const locked = computed(() => !!store.openedReviewId)

/** Offered only once there is a review: before it «what is not committed» is the only sensible view. */
const options = computed(() => {
  if (store.openedReviewId) return [{ value: 'review', label: 'Всё ревью', hint: 'Всё, что вошло в это ревью' }]
  const list = [{ value: 'head', label: 'Незакоммиченное', hint: `Все изменения в папке относительно последнего коммита${store.head ? ' ' + store.head.slice(0, 7) : ''}` }]
  if (store.liveReview && store.repository) {
    if (store.rounds.length) list.push({ value: 'agent', label: 'От агента', hint: 'Только то, что агент поменял после отправки раунда: удобно проверять его правки' })
    list.push({ value: 'review', label: 'Всё ревью', hint: 'Всё, что изменилось с начала ревью, включая сделанные с тех пор коммиты' })
  }
  return list
})
const kind = computed(() => store.effectiveBase)
const round = computed(() => store.baseRound ?? store.rounds[store.rounds.length - 1]?.id)
function pick(value: string) {
  if (value === 'agent') void store.setBase('agent', store.rounds[store.rounds.length - 1]?.id ?? null)
  else void store.setBase(value === 'review' ? 'review' : 'head')
}
</script>

<style scoped>
.bs { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.bs-label { color: var(--text-muted); white-space: nowrap; }
.bs-group { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.bs-option { padding: 2px 8px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; white-space: nowrap; }
.bs-option + .bs-option { border-left: 1px solid var(--border-strong); }
.bs-option:hover:not(:disabled) { color: var(--text); }
.bs-option.on { color: var(--text); background: var(--blue-soft); }
.bs-option:disabled { cursor: default; }
.bs-option:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.bs-round { padding: 1px 4px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
</style>
