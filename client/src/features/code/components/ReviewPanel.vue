<template>
  <section class="rp">
    <div class="rp-actions">
      <AppButton size="xs" variant="ghost" :disabled="readOnly || composing" title="Замечание не к конкретной строке: структура, несколько файлов, общее впечатление" @click="composing = true">+ Общее</AppButton>
      <SendButton
        v-if="!readOnly" :label="sendLabel" :chats="targets" :default-target="chats.latest.value?.session.id ?? ''"
        :disabled="!toSend.length || agentWorking" :reason="agentWorking ? 'Агент отвечает: дождитесь конца ответа' : 'Нет черновиков. Отметьте пункты, чтобы отправить их снова'"
        @send="send"
      />
      <span v-if="agentWorking" class="rp-working">агент работает…</span>
      <FinishReview v-if="store.liveReview && !readOnly" class="rp-finish" />
    </div>
    <div v-if="selected.size" class="rp-selection">
      Выбрано {{ selected.size }}: «Отправить» отдаст агенту только их<template v-if="pickedAnswered"> · отвеченные вопросы агент сделает по своему ответу</template>
      <button type="button" class="rp-link" @click="selected.clear()">Сбросить</button>
    </div>
    <div class="rp-meta">
      <template v-if="review">Ревью #{{ review.number }}<template v-if="rounds"> · раунд {{ rounds }}</template></template>
      <span v-if="readOnly" class="rp-ro" title="Это ревью другой ветки или завершено: только чтение">только чтение</span>
    </div>

    <div class="rp-list">
      <ItemComposer v-if="composing" where="Общее замечание" general :busy="busy" :error="error" @save="saveGeneral" @cancel="composing = false" />
      <div v-if="!items.length && !composing" class="rp-empty">
        Замечаний пока нет. Нажмите на номер строки в коде, 💬 в шапке файла или «+ Общее». Черновики сохраняются, агенту ничего не уходит, пока вы не нажмёте «Отправить».
      </div>
      <RecentReviews v-if="store.screen === 'clean'" />
      <ItemView
        v-for="item in active" :key="item.id" :item="item" :read-only="readOnly" show-location :agent-working="agentWorking"
        :selectable="!readOnly && sendable(item)" :selected="selected.has(item.id)" @toggle="toggle(item)"
        @implement="emit('send', [item.id], chats.chatOf(item)?.session.id ?? chats.latest.value?.session.id ?? '')"
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
import { computed, reactive, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'
import { useReviewChats } from '../composables/review-chats'
import type { CodeReviewItem } from '../types'
import FinishReview from './FinishReview.vue'
import ItemComposer from './ItemComposer.vue'
import RecentReviews from './RecentReviews.vue'
import ItemView from './ItemView.vue'
import SendButton from './SendButton.vue'

const props = defineProps<{
  origin: { type: 'project' | 'task'; id: string }
  agentWorking?: boolean
}>()
const emit = defineEmits<{
  /** `ids` null: all drafts. `target` is a chat id, '' for a new chat. */
  send: [ids: string[] | null, target: string]
  goto: [item: CodeReviewItem]; discuss: [item: CodeReviewItem]; 'open-ref': [ref: string]
}>()
const store = useCodeStore()
const app = useAppStore()
const chats = useReviewChats()
const composing = ref(false)
const busy = ref(false)
const error = ref('')
const selected = reactive(new Set<string>())

const review = computed(() => store.review)
const items = computed(() => store.items)
const readOnly = computed(() => store.readOnly || (!!store.openedReviewId && store.openedReview?.review.status !== 'open'))
const rounds = computed(() => store.openedReview?.rounds.length ?? store.current?.summary?.rounds ?? 0)
// Decisions first: they block the review; then the order of creation.
const RANK: Record<string, number> = { needs_decision: 0 }
const active = computed(() => items.value.filter(i => !i.outdated).sort((a, b) => (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1)))
const outdated = computed(() => items.value.filter(i => i.outdated))
const targets = computed(() => chats.list.value.map(c => ({ id: c.session.id, title: c.session.title, status: c.session.status })))

/** What the server accepts in a round: drafts, answered questions (to implement), disputed items (to insist on). */
const sendable = (item: CodeReviewItem) => !item.outdated && (item.status === 'draft' || item.status === 'needs_decision' || (item.status === 'answered' && item.kind === 'question'))
// A selection that is no longer sendable (sent meanwhile, deleted) drops out by itself.
watch(items, list => { for (const id of [...selected]) if (!list.some(i => i.id === id && sendable(i))) selected.delete(id) })
const toggle = (item: CodeReviewItem) => (selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id))
const toSend = computed(() => (selected.size ? [...selected] : items.value.filter(i => i.status === 'draft').map(i => i.id)))
const pickedAnswered = computed(() => items.value.some(i => selected.has(i.id) && i.status === 'answered'))
const sendLabel = computed(() => `Отправить${toSend.value.length ? ' ' + toSend.value.length : ''}`)

function send(target: string) {
  emit('send', selected.size ? [...selected] : null, target)
  selected.clear()
}

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
.rp-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 8px 12px 4px; }
.rp-finish { margin-left: auto; }
.rp-working { font-size: 11px; color: var(--blue-hover); }
.rp-selection { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 2px 12px 4px; padding: 4px 8px; font-size: 11px; color: var(--text-muted); background: var(--blue-soft); border-radius: var(--radius-sm); }
.rp-link { margin-left: auto; padding: 0; font: inherit; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.rp-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; min-height: 20px; padding: 0 12px 4px; font-size: 11px; color: var(--text-muted); }
.rp-ro { padding: 0 6px; font-size: 10px; border-radius: var(--radius-pill); background: var(--bg3); color: var(--warning-text); }
.rp-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
.rp-empty { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.rp-section { margin-top: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
</style>
