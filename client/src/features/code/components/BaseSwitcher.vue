<template>
  <div v-if="store.repository && kind === 'remote'" class="bs remote">
    <span class="bs-label">Diff ветки с</span>
    <select class="bs-select" :value="store.remoteRef" aria-label="С какой веткой сравнить" @change="store.setBase('remote', ($event.target as HTMLSelectElement).value)">
      <option v-for="branch in remoteBranches" :key="branch.ref" :value="branch.name">{{ branch.name }}</option>
    </select>
    <span class="bs-spacer" />
    <button type="button" class="bs-close" title="Вернуться к незакоммиченным изменениям" aria-label="Закрыть diff ветки" @click="store.setBase('head')">✕</button>
  </div>
  <div v-else-if="store.repository && options.length > 1" class="bs">
    <div class="bs-group" role="radiogroup" aria-label="Какие изменения показать">
      <button
        v-for="option in options" :key="option.value" type="button" role="radio" class="bs-option" :class="{ on: kind === option.value }"
        :aria-checked="kind === option.value" :disabled="locked" :title="option.hint" @click="pick(option.value)"
      >{{ option.label }}</button>
    </div>
    <select
      v-if="kind === 'agent' && store.rounds.length > 1" class="bs-select" :value="round" title="После какого раунда показать изменения агента"
      @change="store.setBase('agent', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="r in [...store.rounds].reverse()" :key="r.id" :value="r.id">после раунда {{ r.n }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGitStore } from '../stores/git'
import { useCodeStore } from '../stores/code'

/** What the changes list shows: the folder against HEAD, the review's rounds, or the branch against another one. */
const store = useCodeStore(), git = useGitStore()
const remoteBranches = computed(() => {
  const list = git.branches.filter(b => b.remote)
  // A ref typed before the last fetch stays selectable.
  return store.remoteRef && !list.some(b => b.name === store.remoteRef) ? [{ name: store.remoteRef, ref: store.remoteRef, remote: true }, ...list] : list
})
/** An opened historical review is always «everything that entered it»: the base cannot be changed there. */
const locked = computed(() => !!store.openedReviewId)

/** Offered only once there is a review: before it «what is not committed» is the only sensible view. */
const options = computed(() => {
  if (store.openedReviewId) return [{ value: 'review', label: 'Всё ревью', hint: 'Всё, что вошло в это ревью' }]
  const list = [{ value: 'head', label: 'Незакоммиченное', hint: `Все изменения в папке относительно последнего коммита${store.head ? ' ' + store.head.slice(0, 7) : ''}` }]
  if (store.liveReview) {
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
.bs.remote { background: var(--blue-soft); }
.bs-label { color: var(--text-muted); white-space: nowrap; }
.bs-spacer { flex: 1; }
.bs-group { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.bs-option { padding: 2px 8px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; white-space: nowrap; }
.bs-option + .bs-option { border-left: 1px solid var(--border-strong); }
.bs-option:hover:not(:disabled) { color: var(--text); }
.bs-option.on { color: var(--text); background: var(--blue-soft); }
.bs-option:disabled { cursor: default; }
.bs-option:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.bs-select { min-width: 0; max-width: 180px; padding: 1px 4px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.bs-close { padding: 0 6px; font: inherit; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.bs-close:hover { color: var(--text); }
</style>
