<template>
  <div v-if="banners.length" class="rb">
    <div v-for="banner in banners" :key="banner.id" class="rb-row" :class="banner.tone" role="status">
      <span class="rb-text">{{ banner.text }}</span>

      <template v-if="banner.id === 'opened'">
        <AppButton variant="ghost" size="xs" @click="store.openReview(null)">← К текущему</AppButton>
        <AppButton v-if="abandoned" variant="ghost" size="xs" title="Брошенное ревью: незакрытые пункты будут отклонены" @click="finishAbandoned">Завершить</AppButton>
        <AppButton variant="danger-ghost" size="xs" title="Удалить ревью вместе с его чатами с агентом" @click="removeOpened">Удалить</AppButton>
      </template>
      <AppButton v-else-if="banner.id === 'other'" variant="ghost" size="xs" @click="store.openReview(store.otherReview!.review.id)">Открыть только для чтения</AppButton>
      <template v-else-if="banner.id === 'committed'">
        <FinishReview inline label="Завершить" variant="blue" @open-items="emit('open-items')" />
        <AppButton variant="ghost" size="xs" title="Не спрашивать, пока не появится новый коммит" @click="store.continueReview()">Продолжить</AppButton>
      </template>
      <template v-else-if="banner.id === 'summary'">
        <AppButton variant="ghost" size="xs" @click="store.setBase(store.effectiveBase === 'review' ? 'head' : 'review')">{{ store.effectiveBase === 'review' ? 'Скрыть' : 'Показать всё, что вошло в ревью' }}</AppButton>
        <FinishReview inline label="Завершить ревью" variant="blue" @open-items="emit('open-items')" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'
import { commitWord, plural, remarkWord, roundWord } from '../utils/words'
import FinishReview from './FinishReview.vue'

const emit = defineEmits<{ 'open-items': [] }>()
const store = useCodeStore()
const app = useAppStore()

type Banner = { id: 'opened' | 'other' | 'elsewhere' | 'working' | 'committed' | 'summary'; tone: 'info' | 'warn'; text: string }
const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 7) : '—')
const abandoned = computed(() => store.openedReview?.review.status === 'abandoned')

const banners = computed<Banner[]>(() => {
  const list: Banner[] = []
  const opened = store.openedReview?.review
  if (opened) {
    const end = opened.head_end ?? opened.head_last
    const state = opened.status === 'abandoned' ? 'ветка удалена или переименована — ревью брошено' : opened.status === 'closed' ? 'завершено' : 'ветка не выбрана, только чтение'
    list.push({ id: 'opened', tone: 'info', text: `Ревью #${opened.number} · ${opened.branch ?? 'вне ветки'} · ${short(opened.head_start)} → ${short(end)} · ${state}` })
    return list
  }
  const review = store.liveReview
  const other = store.otherReview
  if (other) {
    const count = other.items == null ? '' : ` (${plural(other.items, remarkWord)})`
    list.push({ id: 'other', tone: 'info', text: `На ветке ${other.review.branch ?? short(other.review.head_commit)} есть незавершённое ревью #${other.review.number}${count}` })
  }
  const away = store.runningElsewhere[0]
  if (away) list.push({ id: 'elsewhere', tone: 'warn', text: `Агент работает с файлами ветки ${away.branch ?? short(away.head_commit)}: Plangent ветки не переключает, правки агента пойдут туда, где он запущен` })
  if (!review) return list
  const state = store.screen
  if (state === 'agent-working') {
    list.push({ id: 'working', tone: 'warn', text: 'Агент работает над замечаниями. Новый раунд отправить нельзя, черновики писать можно. Не правьте те же файлы параллельно: ваши правки смешаются с правками агента.' })
  } else if (state === 'committed' && store.commitBannerShown) {
    list.push({ id: 'committed', tone: 'warn', text: `Изменения закоммичены (${short(store.head)}). Завершить ревью #${review.number}?` })
  } else if (state === 'all-committed') {
    const summary = store.current?.summary
    const parts = [`Ревью #${review.number}`, `${short(summary?.head_start)} → ${short(store.head)}`]
    if (summary?.commits != null) parts.push(plural(summary.commits, commitWord))
    parts.push(plural(summary?.rounds ?? 0, roundWord), plural(summary?.items ?? 0, remarkWord))
    const tail = store.unresolved ? ` · не закрыто ${store.unresolved}` : ' · все закрыты'
    list.push({ id: 'summary', tone: 'info', text: parts.join(' · ') + tail })
  }
  return list
})

async function removeOpened() {
  const review = store.openedReview?.review
  if (review && await app.confirm(`Удалить ревью #${review.number} вместе с его чатами с агентом? Это нельзя отменить.`, { confirmLabel: 'Удалить', danger: true })) {
    try { await store.removeReview(review.id) } catch (cause) { app.toast(cause instanceof Error ? cause.message : 'Не удалось удалить', 'error') }
  }
}
async function finishAbandoned() {
  const review = store.openedReview?.review
  if (!review) return
  try { await store.finish(review.id, 'close'); app.toast(`Ревью #${review.number} завершено`, 'success') }
  catch (cause) { app.toast(cause instanceof Error ? cause.message : 'Не удалось завершить', 'error') }
}
</script>

<style scoped>
.rb { display: flex; flex-direction: column; flex-shrink: 0; }
.rb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.rb-row.warn { background: var(--warning-bg, var(--bg2)); box-shadow: inset 3px 0 0 var(--warning); }
.rb-row.info { box-shadow: inset 3px 0 0 var(--blue); }
.rb-text { flex: 1 1 320px; min-width: 0; color: var(--text); }
</style>
