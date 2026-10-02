<template>
  <div class="source">
    <div class="source-header app-drag">
      <div class="source-title">
        <h1><span class="source-icon">📘</span>@{{ source.key }}</h1>
        <span class="source-path">{{ source.repo_path }}</span>
      </div>
      <div class="source-actions">
        <AppButton variant="ghost" size="sm" @click="$emit('edit')">Настройки</AppButton>
        <AppButton variant="danger-ghost" size="sm" @click="$emit('delete')">Удалить</AppButton>
      </div>
    </div>

    <div class="source-body">
      <section v-if="source.source_type === 'docs'" class="sync">
        <h3>{{ SYNC.title }}</h3>
        <div v-if="needsPassword" class="notice warn" role="alert">
          <span>{{ NEEDS_UPDATE.text }}</span>
          <AppButton size="xs" variant="update" @click="fixPassword">{{ NEEDS_UPDATE.action }}</AppButton>
        </div>
        <div class="sync-card" :class="card.tone" role="status">
          <div class="sync-head">
            <span class="sync-icon">
              <svg v-if="card.tone === 'ok'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
              <svg v-else-if="card.tone === 'error' || card.tone === 'warn'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 4.5v4.5M8 11.5v.01" /><circle cx="8" cy="8" r="6" /></svg>
              <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" :class="{ spin: running }"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" /></svg>
            </span>
            <div class="sync-text">
              <div class="sync-title">{{ card.title }}</div>
              <div class="sync-sub">{{ card.sub }}</div>
            </div>
            <AppButton v-if="running" size="sm" variant="ghost" :disabled="busy" @click="cancel">{{ SYNC.cancel }}</AppButton>
            <AppButton v-else-if="!confirmation" size="sm" variant="primary" :disabled="busy || !selection.length" :title="selection.length ? '' : SYNC.noSections" @click="sync(false)">{{ SYNC.update }}</AppButton>
          </div>
          <progress v-if="running" class="sync-progress" :value="progress?.stage === 'download' ? (progress.processed ?? progress.downloaded) : undefined" :max="progress?.total || 1" aria-label="Прогресс синхронизации" />
          <div v-if="confirmation" class="sync-confirm">
            <AppButton size="sm" variant="update" :disabled="busy" @click="sync(true)">{{ SYNC.confirmAction(stats.confirmation_count || 0) }}</AppButton>
            <AppButton size="sm" variant="ghost" @click="$emit('edit')">{{ SYNC.narrow }}</AppButton>
          </div>
          <p v-if="report" class="sync-report">{{ report }}</p>
          <details v-if="warnings.length" class="sync-details">
            <summary>{{ SYNC.details }} ({{ warnings.length }})</summary>
            <ul><li v-for="w in warnings" :key="w">{{ w }}</li></ul>
          </details>
        </div>
        <p class="muted">
          <template v-if="connection">Подключение «{{ connection.name }}» · <code>{{ connection.base_url }}</code> · </template>
          {{ selection.length ? `Разделов: ${selection.length}` : SYNC.noSections }}
        </p>
        <p class="muted">{{ SYNC.background }}</p>
      </section>
      <section>
        <h3>Описание для агента</h3>
        <p v-if="source.description" class="text">{{ source.description }}</p>
        <p v-else class="muted">Не задано. Агент увидит только имя и путь — с описанием ему проще понять, когда сюда заглядывать.</p>
      </section>
      <section>
        <h3>Доступно</h3>
        <p v-if="source.config.available_everywhere" class="text">Везде: агенты всех проектов знают об этом справочнике.</p>
        <template v-else-if="targets.length">
          <p class="text">Агенты этих групп и проектов знают о справочнике:</p>
          <div class="chips"><span v-for="t in targets" :key="t.id" class="chip">{{ t.kind === 'group' ? '🗂' : '📁' }} {{ t.name }}</span></div>
        </template>
        <p v-else class="muted">Никому — агент узнает о справочнике, только когда вы упомянете @{{ source.key }}.</p>
      </section>
      <section>
        <h3>Как пользоваться</h3>
        <p class="text">
          В чате или задаче напишите <code>@{{ source.key }}</code> или <code>@{{ source.key }}/путь/к/файлу</code>.
          Агент получает только имя, путь и описание — сами файлы читает, когда это нужно, и никогда не меняет.
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { Project } from '@core/models'
import type { Connection } from '@core/models/integrations'
import AppButton from '@shared/ui/AppButton.vue'
import { errorText } from '@shared/utils/errorText'
import { formatDateTime } from '@shared/utils/format'
import { useProjectsStore } from '../stores/projects'
import { ERRORS, NEEDS_UPDATE, SYNC, WARNINGS } from '../utils/docs-hints'

const props = defineProps<{ source: Project }>()
defineEmits<{ edit: []; delete: [] }>()
const projectsStore = useProjectsStore()
const app = useAppStore(), router = useRouter(), busy = ref(false)
const progress = computed(() => projectsStore.syncProgress[props.source.id])
const stats = computed(() => props.source.sync_stats || {})
const selection = computed(() => props.source.docs_selection ?? [])
const running = computed(() => props.source.sync_status === 'running')
const confirmation = computed(() => !running.value && stats.value.code === 'confirmation_required')

// The connection's state: a password that stopped working blocks every sync until it is changed.
const connection = ref<Connection | null>(null)
watch(() => [props.source.connection_id, props.source.sync_status], async () => {
  const id = props.source.source_type === 'docs' ? props.source.connection_id : null
  connection.value = id ? await api.get<Connection>('/integrations/connections/' + id).catch(() => null) : null
}, { immediate: true })
const needsPassword = computed(() => connection.value?.last_check_status === 'needs_update' || stats.value.code === 'needs_update' || stats.value.code === 'invalid_credentials')
function fixPassword() { void router?.push({ path: '/settings', query: { tab: 'connections', ...(connection.value ? { fix: connection.value.id } : {}) } }) }

const card = computed((): { tone: string; title: string; sub: string } => {
  const s = stats.value, p = progress.value
  if (running.value) {
    if (p?.stage === 'download') return { tone: 'running', ...SYNC.download(p.processed ?? p.downloaded, p.total, p.found) }
    if (p) return { tone: 'running', ...SYNC.discover(p.found) }
    return { tone: 'running', ...SYNC.starting }
  }
  if (confirmation.value) return { tone: 'warn', ...SYNC.confirm(s.confirmation_count || 0, s.found) }
  const when = formatDateTime(props.source.last_sync_at)
  const status = props.source.sync_status || 'idle'
  if (status === 'error') return { tone: 'error', title: SYNC.error.title, sub: s.message ? errorText(s.message, ERRORS) : SYNC.errors(s.errors || 0) }
  if (status === 'cancelled') return { tone: 'muted', title: SYNC.cancelled.title, sub: s.message ? errorText(s.message, ERRORS) : when }
  if (status === 'done') return { tone: 'ok', title: SYNC.done.title, sub: [when, s.found !== undefined ? `документов: ${s.found}` : ''].filter(Boolean).join(' · ') }
  return { tone: 'muted', ...SYNC.idle }
})
// Numbers of the last finished run; a failed run keeps the previous numbers, so they are not shown then.
const report = computed(() => {
  const s = stats.value
  if (running.value || s.message || s.added === undefined) return ''
  const unchanged = (s.found ?? 0) - (s.added ?? 0) - (s.updated ?? 0) - (s.errors ?? 0)
  return [SYNC.report(s), unchanged > 0 ? SYNC.unchanged(unchanged) : '', s.errors ? SYNC.errors(s.errors) : ''].filter(Boolean).join(' · ')
})
const warnings = computed(() => running.value ? [] : (stats.value.warnings ?? []).map(w => errorText(w, [...WARNINGS, ...ERRORS])))

async function sync(confirmed: boolean) {
  if (confirmed && !(await app.confirm(SYNC.confirmQuestion(stats.value.confirmation_count || 0), { confirmLabel: SYNC.confirmAction(stats.value.confirmation_count || 0) }))) return
  busy.value = true
  try { await projectsStore.startSync(props.source.id, confirmed) } catch (e) { app.toast(errorText(e, ERRORS), 'error') } finally { busy.value = false }
}
async function cancel() { busy.value = true; try { await projectsStore.cancelSync(props.source.id) } catch (e) { app.toast(errorText(e, ERRORS), 'error') } finally { busy.value = false } }const targets = computed(() => (props.source.targets ?? []).map(id => projectsStore.byId(id)).filter(p => !!p))
</script>

<style scoped>
.source { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.source-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: calc(var(--titlebar-h) + var(--sp-3)) var(--sp-6) var(--sp-3);
  border-bottom: 1px solid var(--border);
}
.source-title { min-width: 0; }
.source-title h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.source-icon { margin-right: 8px; font-family: initial; }
.source-path { display: block; font-size: 12px; color: var(--text-muted); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.source-body { flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-5); max-width: 720px; }
h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin-bottom: 6px; }
.text { font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.muted { font-size: 13px; color: var(--text-muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { padding: 3px 8px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; }
code { padding: 1px 5px; background: var(--bg3); border-radius: 4px; font-size: 12px; }

/* Sync card: same visual language as the update popup (tone icon, title, sub line, thin bar). */
.sync { display: flex; flex-direction: column; gap: 8px; }
.sync h3 { margin-bottom: 0; }
.notice { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12.5px; line-height: 1.5; }
.notice span { flex: 1; min-width: 240px; }
.notice.warn { background: var(--warning-soft); color: var(--warning-text); border: 1px solid rgba(210, 153, 34, 0.4); }
.sync-card {
  --tone: var(--text-muted);
  --tone-soft: var(--bg3);
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.sync-card.running { --tone: var(--blue-hover); --tone-soft: var(--blue-soft); }
.sync-card.ok { --tone: var(--accent-hover); --tone-soft: var(--accent-soft); }
.sync-card.warn { --tone: var(--warning-text); --tone-soft: var(--warning-soft); border-color: rgba(210, 153, 34, 0.4); }
.sync-card.error { --tone: var(--danger-hover); --tone-soft: var(--danger-soft); border-color: rgba(248, 81, 73, 0.35); }
.sync-head { display: flex; align-items: center; gap: 10px; }
.sync-icon { flex-shrink: 0; width: 30px; height: 30px; border-radius: var(--radius-sm); background: var(--tone-soft); color: var(--tone); display: inline-flex; align-items: center; justify-content: center; }
.sync-icon svg { width: 16px; height: 16px; }
.sync-icon .spin { animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.sync-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sync-title { font-size: 13px; font-weight: 600; }
.sync-sub { font-size: 12px; line-height: 1.45; color: var(--text-muted); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.sync-progress { appearance: none; -webkit-appearance: none; width: 100%; height: 4px; border: none; border-radius: var(--radius-pill); background: var(--bg3); overflow: hidden; }
.sync-progress::-webkit-progress-bar { background: var(--bg3); border-radius: var(--radius-pill); }
.sync-progress::-webkit-progress-value { background: var(--tone); border-radius: var(--radius-pill); transition: width 0.3s ease; }
.sync-progress::-moz-progress-bar { background: var(--tone); }
/* Discovery has no total yet: a sliding segment instead of a fake percentage. */
.sync-progress:indeterminate { background: linear-gradient(90deg, var(--bg3) 0%, var(--tone) 50%, var(--bg3) 100%) 0 0 / 40% 100% no-repeat, var(--bg3); animation: slide 1.4s ease-in-out infinite; }
.sync-progress:indeterminate::-webkit-progress-bar { background: transparent; }
@keyframes slide { from { background-position: -40% 0, 0 0; } to { background-position: 140% 0, 0 0; } }
.sync-confirm { display: flex; gap: 8px; flex-wrap: wrap; }
.sync-report { font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sync-details summary { font-size: 12px; color: var(--text-muted); cursor: pointer; }
.sync-details ul { margin-top: 6px; padding-left: 18px; font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow: auto; }
@media (prefers-reduced-motion: reduce) { .sync-icon .spin, .sync-progress:indeterminate { animation: none; } }
</style>
