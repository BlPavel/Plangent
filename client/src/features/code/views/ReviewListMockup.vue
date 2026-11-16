<template>
  <div class="mk">
    <aside class="mk-note">
      <h3>Макет: единый список замечаний</h3>
      <p>Временная страница, данные статичные. Кликайте по строкам, фильтрам, переключателю и меню ⋯.</p>
    </aside>
    <section class="mk-panel">
      <div class="mk-bar">
        <span class="mk-title">Замечания</span>
        <AppBadge title="Ревью по МР !1042">!1042</AppBadge>
        <span class="mk-spacer" />
        <AppButton size="xs" variant="ghost" title="Подтянуть обсуждения МР из GitLab">Обновить</AppButton>
      </div>
      <div class="mk-filters">
        <AppSegmented v-model="filter" label="Фильтр" :options="filters" />
      </div>
      <div class="mk-list">
        <template v-for="(item, index) in shown" :key="item.id">
          <div v-if="item.status === 'closed' && (index === 0 || shown[index - 1].status !== 'closed') && filter === 'all'" class="mk-section">Закрытые</div>
          <div class="mk-row" :class="[item.status, { open: opened === item.id }]">
            <div class="mk-head" role="button" tabindex="0" :aria-expanded="opened === item.id" @click="toggle(item.id)" @keydown.enter.self.prevent="toggle(item.id)">
              <span class="mk-dot" />
              <span class="mk-loc">{{ item.file }}:{{ item.line }}</span>
              <AppBadge v-if="item.source === 'gitlab'" title="Комментарий из GitLab">GitLab</AppBadge>
              <AppBadge v-if="item.parsed.severity" :tone="item.parsed.tone">{{ item.parsed.severity }}</AppBadge>
              <AppBadge v-if="item.parsed.category">{{ item.parsed.category }}</AppBadge>
              <span class="mk-status">{{ STATUS[item.status] }}</span>
              <span v-if="opened !== item.id" class="mk-summary">{{ item.parsed.summary }}</span>
              <span v-if="opened !== item.id" class="mk-author">{{ item.author }}</span>
            </div>

            <div v-if="opened === item.id" class="mk-body">
              <div v-if="item.quote" class="mk-quote">
                <div class="mk-msg-head">{{ item.author }} · GitLab</div>
                <MessageMarkdown :text="item.parsed.body" />
              </div>
              <div v-else class="mk-msg">
                <div class="mk-msg-head">{{ item.author }} · GitLab</div>
                <MessageMarkdown :text="item.parsed.body" />
              </div>
              <div v-for="(m, i) in item.thread" :key="i" class="mk-msg" :class="m.author">
                <div class="mk-msg-head">{{ m.author === 'agent' ? 'Агент' : 'Вы' }}</div>
                <MessageMarkdown :text="m.text" />
              </div>

              <div v-if="item.status !== 'closed'" class="mk-actions">
                <AppButton v-if="item.source === 'gitlab' && !item.thread.length" size="xs" variant="primary" type="button">Разобрать с агентом</AppButton>
                <AppButton size="xs" variant="ghost" type="button">Ответить</AppButton>
                <AppButton size="xs" variant="ghost" type="button">К коду</AppButton>
                <span class="mk-spacer" />
                <AppButton size="xs" variant="danger-ghost" type="button">Закрыть</AppButton>
                <AppMenu :items="menu(item)" size="xs" title="Ещё" />
              </div>
              <div v-if="item.status !== 'closed' && item.source === 'gitlab'" class="mk-sync">
                <AppSwitch v-model="markResolved" label="Отметить решённым в GitLab при закрытии" />
              </div>
              <div v-if="item.status === 'closed'" class="mk-actions">
                <AppButton size="xs" variant="blue" type="button">Вернуть в доработку</AppButton>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/* TEMPORARY mockup of the unified review list: delete once the design is decided. */
import { computed, ref } from 'vue'
import AppBadge from '@shared/ui/AppBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'
import AppSegmented from '@shared/ui/AppSegmented.vue'
import AppSwitch from '@shared/ui/AppSwitch.vue'
import { MessageMarkdown } from '@shared/markdown'

type Status = 'waiting' | 'agent' | 'answered' | 'closed'
const STATUS: Record<Status, string> = { waiting: 'Ждёт вас', agent: 'У агента', answered: 'Агент ответил', closed: 'Закрыто' }
const TONES: Record<string, string> = { '🔴': 'danger', '🟠': 'warning', '🟡': 'warning', '🟢': 'success', '🔵': 'info' }

/** «🟡 **Предложение** · [Баг] текст» → chips and a clean body. */
function parseLabels(raw: string) {
  const m = raw.match(/^\s*([🔴🟠🟡🟢🔵])?\s*\*\*([^*]+)\*\*(?:\s*·\s*\[([^\]]+)\])?\s*/u)
  const body = (m ? raw.slice(m[0].length) : raw).trim()
  const summary = body.replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim()
  return { severity: m?.[2] ?? '', category: m?.[3] ?? '', tone: TONES[m?.[1] ?? ''] ?? 'neutral', body, summary }
}

const raw = [
  { id: 'a', status: 'waiting' as Status, source: 'gitlab', file: 'meeting.guard.ts', line: 42, author: 'Владимир А.', quote: false,
    text: '🟡 **Предложение** · [Баг] Тип `Meeting` здесь не совпадает с тем, что приходит из API: `startsAt` — строка, а не `Date`.\n\n```ts\nif (meeting.startsAt < now) return false\n```', thread: [] },
  { id: 'b', status: 'answered' as Status, source: 'gitlab', file: 'meeting.service.ts', line: 118, author: 'Анна К.', quote: true,
    text: '🔴 **Блокер** · [Безопасность] Нет проверки прав перед удалением встречи.',
    thread: [{ author: 'agent', text: 'Добавил проверку `canDelete` в `remove()`. Теперь без прав вернётся 403.' }] },
  { id: 'c', status: 'agent' as Status, source: 'gitlab', file: 'app.routes.ts', line: 9, author: 'Владимир А.', quote: true,
    text: '🟢 **Замечание** · [Стиль] Лишний импорт `Router`.', thread: [{ author: 'you', text: 'Разберись, прав ли коллега.' }] },
  { id: 'd', status: 'waiting' as Status, source: 'own', file: 'meeting.dto.ts', line: 17, author: 'Вы', quote: false,
    text: 'Переименовать поле `from` в `startsAt`.', thread: [] },
  { id: 'e', status: 'closed' as Status, source: 'gitlab', file: 'meeting.module.ts', line: 3, author: 'Анна К.', quote: true,
    text: '🟡 **Предложение** · [Нейминг] Назвать провайдер `MeetingStore`.', thread: [{ author: 'agent', text: 'Переименовал.' }] },
]
const items = raw.map(r => ({ ...r, parsed: parseLabels(r.text) }))

const filter = ref('all')
const filters = [{ value: 'all', label: 'Все' }, { value: 'waiting', label: 'Ждут вас' }, { value: 'agent', label: 'У агента' }, { value: 'closed', label: 'Закрытые' }]
const ORDER: Record<Status, number> = { waiting: 0, answered: 0, agent: 1, closed: 2 }
const shown = computed(() => items
  .filter(i => filter.value === 'all' || (filter.value === 'waiting' ? ['waiting', 'answered'].includes(i.status) : i.status === filter.value))
  .sort((a, b) => ORDER[a.status] - ORDER[b.status]))
const opened = ref<string | null>('a')
const toggle = (id: string) => { opened.value = opened.value === id ? null : id }
const markResolved = ref(false)
const menu = (item: (typeof items)[number]): MenuItem[] => item.source === 'gitlab'
  ? [{ label: 'Решено в GitLab' }, { label: 'Открыть в GitLab' }, ...(item.author === 'Вы' ? [{ separator: true }, { label: 'Изменить' }, { label: 'Удалить', danger: true }] : [])]
  : [{ label: 'Изменить' }, { label: 'Удалить', danger: true }]
</script>

<style scoped>
.mk { display: flex; gap: var(--sp-4); align-items: flex-start; padding: var(--sp-4); color: var(--text); font-size: var(--fs-sm); }
.mk-note { max-width: 260px; color: var(--text-muted); }
.mk-panel { width: 420px; display: flex; flex-direction: column; border: 1px solid var(--border); background: var(--bg); }
.mk-bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; }
.mk-title { font-weight: var(--fw-semibold); }
.mk-spacer { flex: 1; }
.mk-filters { padding: 4px 12px 6px; border-bottom: 1px solid var(--border); }
.mk-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.mk-section { padding: 4px 4px 0; font-size: var(--fs-xs); color: var(--text-muted); }
.mk-row { border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--bg2); }
.mk-row.waiting, .mk-row.answered { border-left-color: var(--warning-text); }
.mk-row.agent { border-left-color: var(--blue); }
.mk-row.closed { border-left-color: var(--border-strong); opacity: 0.6; }
.mk-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 5px 8px; cursor: pointer; }
.mk-head:hover { background: var(--bg3); }
.mk-head:focus-visible { outline: var(--focus-outline); outline-offset: -2px; }
.mk-dot { width: 7px; height: 7px; border-radius: var(--radius-round); background: var(--text-faint); }
.mk-row.waiting .mk-dot, .mk-row.answered .mk-dot { background: var(--warning-text); }
.mk-row.agent .mk-dot { background: var(--blue-hover); }
.mk-loc { color: var(--text-muted); font-family: var(--font-mono); }
.mk-status { margin-left: auto; font-size: var(--fs-xs); color: var(--text-muted); }
.mk-row.waiting .mk-status, .mk-row.answered .mk-status { color: var(--warning-text); font-weight: var(--fw-semibold); }
.mk-summary { flex-basis: 100%; order: 2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mk-author { flex-basis: 100%; order: 3; font-size: var(--fs-xs); color: var(--text-muted); }
.mk-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 10px 8px; }
.mk-msg { padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg); border-left: 2px solid var(--text-faint); }
.mk-msg.agent { border-left-color: var(--blue); }
.mk-quote { padding: 4px 8px; border-left: 2px solid var(--border-strong); color: var(--text-muted); }
.mk-msg-head { margin-bottom: 2px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--text-muted); }
.mk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.mk-sync { padding-top: 2px; }
</style>
