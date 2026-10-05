<template>
  <section class="rp">
    <header class="rp-head">
      <span class="rp-title">Замечания <span class="rp-count">{{ items.length }}</span></span>
      <span v-if="review" class="rp-meta" :title="review.branch ?? 'вне ветки'">Ревью #{{ review.number }}<template v-if="rounds"> · раунд {{ rounds }}</template></span>
      <span v-if="readOnly" class="rp-ro" title="Это ревью другой ветки или завершено: только чтение">только чтение</span>
    </header>
    <div class="rp-actions">
      <AppButton size="xs" variant="ghost" :disabled="readOnly || composing" title="Замечание не к конкретной строке: структура, несколько файлов, общее впечатление" @click="composing = true">+ Общее</AppButton>
      <AppButton
        size="xs" variant="blue" :disabled="readOnly || !drafts || agentWorking"
        :title="agentWorking ? 'Агент отвечает: дождитесь конца ответа' : drafts ? 'Отправить черновики агенту' : 'Нет черновиков'" @click="emit('send')"
      >Отправить{{ drafts ? ' ' + drafts : '' }}</AppButton>
      <span v-if="agentWorking" class="rp-working">агент работает…</span>
      <FinishReview v-if="store.liveReview && !readOnly" class="rp-finish" />
    </div>

    <div class="rp-list">
      <ItemComposer v-if="composing" where="Общее замечание" general :busy="busy" :error="error" @save="saveGeneral" @cancel="composing = false" />
      <div v-if="!items.length && !composing" class="rp-empty">
        Замечаний пока нет. Нажмите на номер строки в коде, 💬 в шапке файла или «+ Общее». Черновики сохраняются, агенту ничего не уходит, пока вы не нажмёте «Отправить».
      </div>
      <RecentReviews v-if="store.screen === 'clean'" />
      <ItemView
        v-for="item in active" :key="item.id" :item="item" :read-only="readOnly" show-location :agent-working="agentWorking"
        @goto="emit('goto', item)" @discuss="emit('discuss', item)" @open-ref="emit('open-ref', $event)"
      />
      <template v-if="outdated.length">
        <div class="rp-section">Устарели ({{ outdated.length }})</div>
        <ItemView v-for="item in outdated" :key="item.id" :item="item" :read-only="readOnly" show-location @open-ref="emit('open-ref', $event)" />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'
import type { CodeReviewItem } from '../types'
import FinishReview from './FinishReview.vue'
import ItemComposer from './ItemComposer.vue'
import RecentReviews from './RecentReviews.vue'
import ItemView from './ItemView.vue'

const props = defineProps<{
  origin: { type: 'project' | 'task'; id: string }
  agentWorking?: boolean
}>()
const emit = defineEmits<{ send: []; goto: [item: CodeReviewItem]; discuss: [item: CodeReviewItem]; 'open-ref': [ref: string] }>()
const store = useCodeStore()
const app = useAppStore()
const composing = ref(false)
const busy = ref(false)
const error = ref('')

const review = computed(() => store.review)
const items = computed(() => store.items)
const readOnly = computed(() => store.readOnly || (!!store.openedReviewId && store.openedReview?.review.status !== 'open'))
const rounds = computed(() => store.openedReview?.rounds.length ?? store.current?.summary?.rounds ?? 0)
const drafts = computed(() => items.value.filter(i => i.status === 'draft').length)
// Decisions first: they block the review; then the order of creation.
const RANK: Record<string, number> = { needs_decision: 0 }
const active = computed(() => items.value.filter(i => !i.outdated).sort((a, b) => (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1)))
const outdated = computed(() => items.value.filter(i => i.outdated))

async function saveGeneral(value: { kind: 'fix' | 'question'; text: string; refs: string[] }) {
  busy.value = true; error.value = ''
  try {
    await store.addDraft({ scope: 'general', ...value }, props.origin.type, props.origin.id)
    composing.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить'; app.toast(error.value, 'error') }
  finally { busy.value = false }
}
</script>

<style scoped>
.rp { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.rp-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 34px; padding: 4px 12px; }
.rp-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.rp-count { margin-left: 4px; padding: 0 6px; font-size: 10px; border-radius: var(--radius-pill); background: var(--bg3); }
.rp-meta { margin-left: auto; font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.rp-ro { padding: 0 6px; font-size: 10px; border-radius: var(--radius-pill); background: var(--bg3); color: var(--warning-text); }
.rp-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 0 12px 8px; }
.rp-finish { margin-left: auto; }
.rp-working { font-size: 11px; color: var(--blue-hover); }
.rp-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
.rp-empty { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.rp-section { margin-top: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
</style>
