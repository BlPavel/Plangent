<template>
  <div class="ml">
    <div class="ml-bar">
      <div class="ml-seg" role="group" aria-label="Какие МР">
        <button v-for="o in whoOptions" :key="o.value" type="button" :class="{ on: filters.who === o.value }" @click="filters.who = o.value">{{ o.label }}<span v-if="o.count" class="ml-seg-count">{{ o.count }}</span></button>
      </div>
      <span class="ml-below"><PlainSelect :model-value="String(filters.below)" :options="belowOptions" small label="Аппрувы" @update:model-value="filters.below = Number($event)" /></span>
      <input v-model="filters.search" class="control control-sm ml-search" placeholder="Поиск: название, автор, ветка, !номер" spellcheck="false" />
      <span class="ml-spacer" />
      <button type="button" class="btn btn-subtle btn-sm" :disabled="loading" title="Загрузить открытые МР из GitLab" @click="emit('refresh')">{{ loading ? 'Загрузка…' : 'Обновить' }}</button>
    </div>
    <div v-for="e in errors" :key="e.project_id" role="alert" class="ml-error">{{ many ? e.project_name + ': ' : '' }}{{ e.message }}</div>
    <div v-if="loading && !items.length" class="empty-state small">Загрузка МР…</div>
    <div v-else-if="!shown.length" class="empty-state small">{{ items.length ? 'Под фильтр не попал ни один МР.' : 'Открытых МР нет.' }}</div>
    <ul v-else class="ml-list">
      <li v-for="mr in shown" :key="key(mr)">
        <button type="button" class="ml-row" :class="{ mine: mr.mine, opening: opening === key(mr) }" :disabled="!!opening" @click="emit('open', mr)">
          <span class="ml-main">
            <span class="ml-title"><span class="ml-iid">!{{ mr.iid }}</span> {{ mr.title }}</span>
            <span class="ml-sub">
              <span class="ml-author">{{ mr.mine ? 'Вы' : mr.author.name || mr.author.username }}</span>
              <span class="ml-branches" :title="mr.source_branch + ' → ' + mr.target_branch">
                <span class="ml-branch">{{ mr.source_branch }}</span><span class="ml-arrow">→</span><span class="ml-branch">{{ mr.target_branch }}</span>
              </span>
              <span v-if="many" class="ml-project">{{ mr.project_name }}</span>
            </span>
          </span>
          <span class="ml-status">
            <span v-for="s in statuses(mr)" :key="s.text" class="ml-chip" :class="s.tone" :title="s.title">{{ s.text }}</span>
          </span>
          <span class="ml-approvals" :class="{ mine: mr.approvals?.mine }" :title="approvalsTitle(mr)">{{ approvalsText(mr) }}</span>
          <span class="ml-notes" title="Комментариев">💬 {{ mr.notes }}</span>
          <span v-if="opening === key(mr)" class="ml-time ml-opening"><span class="ml-spin" />Открываю</span>
          <span v-else class="ml-time" :title="'Обновлён ' + formatDateTime(mr.updated_at)">{{ ago(mr.updated_at) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import { formatDateTime } from '@shared/utils/format'
import type { MrListItem } from '../types'
import { useBranchReviewStore, type MrFilters } from '../stores/review'

/** Open merge requests of the project (or of every project of a group), filtered like in GitLab. */
const props = defineProps<{ screenKey: string; items: MrListItem[]; errors: { project_id: string; project_name: string; message: string }[]; loading?: boolean; opening?: string | null }>()
const emit = defineEmits<{ open: [mr: MrListItem]; refresh: [] }>()
// The filters live with the screen: they survive leaving the tab.
const filters = useBranchReviewStore().of(props.screenKey).filters
const key = (mr: MrListItem) => mr.project_id + ':' + mr.iid
const matches = (mr: MrListItem, who: MrFilters['who']) =>
  who === 'all' || (who === 'mine' ? mr.mine : who === 'review' ? mr.reviewer : !mr.mine && !mr.approvals?.mine)
const whoOptions = computed(() => [
  { value: 'all' as const, label: 'Все', count: 0 },
  { value: 'review' as const, label: 'Я ревьюер', count: props.items.filter(mr => matches(mr, 'review')).length },
  { value: 'unapproved' as const, label: 'Без моего аппрува', count: 0 },
  { value: 'mine' as const, label: 'Мои', count: props.items.filter(mr => matches(mr, 'mine')).length },
])
const belowOptions = [
  { value: '0', label: 'Любые аппрувы' },
  { value: '1', label: 'Без аппрувов' },
  { value: '2', label: 'Аппрувов < 2' },
  { value: '3', label: 'Аппрувов < 3' },
]
const many = computed(() => new Set(props.items.map(i => i.project_id)).size > 1 || props.errors.length > 1)
const shown = computed(() => {
  const q = filters.search.trim().toLowerCase().replace(/^!/, '')
  return props.items.filter(mr =>
    matches(mr, filters.who) &&
    (!filters.below || (mr.approvals?.count ?? 0) < filters.below) &&
    (!q || String(mr.iid) === q || [mr.title, mr.author.name, mr.author.username, mr.source_branch, mr.target_branch].some(v => v.toLowerCase().includes(q))))
})
/** What matters to a reviewer: what needs me now. */
function statuses(mr: MrListItem) {
  const list: { text: string; tone: string; title: string }[] = []
  const t = mr.threads
  if (mr.mine) {
    list.push({ text: 'мой МР', tone: 'blue', title: 'Вы автор' })
    if (t?.open) list.push({ text: 'замечаний: ' + t.open, tone: 'warn', title: 'Нерешённые обсуждения в вашем МР' })
    return list
  }
  if (mr.after_review) list.push({ text: 'новые коммиты', tone: 'warn', title: 'Автор запушил после ваших замечаний: пора посмотреть снова' })
  if (t?.mine_open) list.push({ text: 'мои треды: ' + t.mine_open, tone: 'warn', title: 'Ваши нерешённые обсуждения' })
  if (mr.reviewer && !mr.approvals?.mine) list.push({ text: 'ждёт меня', tone: 'blue', title: 'Вы ревьюер и ещё не аппрувнули' })
  return list
}
function approvalsText(mr: MrListItem) {
  const a = mr.approvals
  if (!a) return '✓ —'
  return '✓ ' + a.count + (a.required ? '/' + a.required : '')
}
function approvalsTitle(mr: MrListItem) {
  const a = mr.approvals
  if (!a) return 'GitLab не отдал аппрувы для этого МР'
  return (a.names.length ? 'Аппрувнули: ' + a.names.join(', ') : 'Аппрувов нет') + (a.mine ? ' (в том числе вы)' : '') + (a.left ? ' · осталось ' + a.left : '')
}
function ago(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 60) return Math.max(minutes, 1) + ' мин'
  if (minutes < 60 * 24) return Math.round(minutes / 60) + ' ч'
  if (minutes < 60 * 24 * 30) return Math.round(minutes / 60 / 24) + ' дн'
  return formatDateTime(value)
}
</script>
<style scoped>
.ml { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.ml-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.ml-seg { display: inline-flex; height: var(--size-sm); box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.ml-seg button { display: inline-flex; align-items: center; gap: 5px; height: 100%; padding: 0 10px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.ml-seg button + button { border-left: 1px solid var(--border-strong); }
.ml-seg button.on { color: var(--text); background: var(--blue-soft); }
.ml-seg-count { font-size: 10.5px; color: var(--text-faint); }
.ml-below { width: 150px; flex-shrink: 0; }
/* `input.control` outweighs `.control-sm` globally: the small height is set here so the whole bar is one height. */
.ml-below :deep(.control) { width: 100%; height: var(--size-sm); }
.ml-search { width: 280px; height: var(--size-sm); }
.ml-spacer { flex: 1; }
.ml-error { flex-shrink: 0; padding: 6px 10px; font-size: 12px; color: var(--danger-hover); background: var(--danger-soft); border-radius: var(--radius-sm); overflow-wrap: anywhere; }
.ml-list { flex: 1; min-height: 0; overflow: auto; list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); }
.ml-list li + li { border-top: 1px solid var(--border); }
.ml-row { display: grid; grid-template-columns: minmax(0, 1fr) 230px 56px 48px 76px; align-items: center; gap: 12px; width: 100%; padding: 8px 12px 8px 9px; font: inherit; text-align: left; color: var(--text); background: none; border: none; border-left: 3px solid transparent; cursor: pointer; }
.ml-row:hover:not(:disabled) { background: var(--bg-hover); }
.ml-row:disabled { cursor: default; }
.ml-row:disabled:not(.opening) { opacity: 0.55; }
.ml-row.mine { border-left-color: var(--blue); }
.ml-row.opening { background: var(--blue-soft); }
.ml-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ml-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ml-iid { color: var(--text-muted); font-weight: 400; }
.ml-sub { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11.5px; line-height: 16px; color: var(--text-muted); white-space: nowrap; }
.ml-author { flex-shrink: 0; }
.ml-branches { display: inline-flex; align-items: center; gap: 4px; min-width: 0; font-family: var(--font-mono, monospace); font-size: 11px; line-height: 16px; }
.ml-branch { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ml-arrow { flex-shrink: 0; color: var(--text-faint); }
.ml-project { flex-shrink: 0; padding: 0 6px; border-radius: var(--radius-pill); background: var(--bg3); }
.ml-status { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.ml-chip { padding: 1px 8px; font-size: 11px; line-height: 16px; white-space: nowrap; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.ml-chip.blue { background: var(--blue-soft); color: var(--blue-hover); }
.ml-chip.warn { background: var(--warning-soft); color: var(--warning-text); }
.ml-approvals { font-size: 12px; color: var(--text-muted); }
.ml-approvals.mine { color: var(--accent-hover); }
.ml-notes, .ml-time { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
.ml-time { text-align: right; }
.ml-opening { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; color: var(--blue-hover); }
.ml-spin { width: 10px; height: 10px; border: 2px solid var(--blue-soft); border-top-color: var(--blue-hover); border-radius: 50%; animation: ml-spin 0.8s linear infinite; }
@keyframes ml-spin { to { transform: rotate(360deg); } }
</style>
