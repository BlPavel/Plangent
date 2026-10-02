<template>
  <div v-if="proposal" class="proposal" :class="[proposal.status, { main: proposal.type === 'main' }]">
    <div class="head">
      <span class="kind">{{ kindLabel }}</span>
      <span class="title">{{ proposal.title }}</span>
      <code class="slug">{{ proposal.slug }}</code>
      <span class="status" :class="proposal.status">{{ STATUS[proposal.status] }}</span>
    </div>

    <div class="explanation">{{ proposal.explanation }}</div>

    <div v-if="proposal.type === 'main'" class="main-note">
      Главный файл всегда в контексте агента: правка влияет на каждую задачу там, где он доступен. Проверьте изменения целиком.
    </div>
    <div v-if="shared" class="shared-note">
      Элемент общий, из группы. При применении этот проект получит свою копию, а у группы и других проектов всё останется как было.
    </div>

    <div v-if="fields.length" class="fields">
      <div v-for="f in fields" :key="f.label" class="field">
        <span class="field-label">{{ f.label }}</span>
        <span class="field-value">
          <del v-if="f.before !== undefined">{{ f.before || '—' }}</del>
          <span>{{ f.after || '—' }}</span>
        </span>
      </div>
    </div>

    <details class="diff" :open="diffOpen" @toggle="diffOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        {{ proposal.action === 'create' ? 'Текст' : 'Изменения' }}
        <span class="stat"><span class="plus">+{{ stats.add }}</span><span v-if="proposal.action === 'update'" class="minus">−{{ stats.del }}</span></span>
        <span v-if="proposal.action === 'update' && !stats.add && !stats.del" class="stat-none">текст не меняется</span>
      </summary>
      <div class="diff-body">
        <template v-for="(row, i) in rows" :key="i">
          <div v-if="row.kind === 'skip'" class="line skip">… {{ row.count }} {{ plural(row.count) }} без изменений</div>
          <div v-else class="line" :class="row.kind"><span class="sign">{{ row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' ' }}</span>{{ row.text || ' ' }}</div>
        </template>
      </div>
    </details>

    <div v-if="pending" class="where">
      <span class="where-label">Доступно:</span>
      <span class="where-value">{{ whereLabel }}</span>
      <button v-if="!shared" type="button" class="link" @click="editWhere = !editWhere">{{ editWhere ? 'Готово' : 'Изменить' }}</button>
    </div>
    <AvailabilityField
      v-if="editWhere && pending && !shared"
      v-model="availability" class="availability" own-folder allow-everywhere :within="proposal.project_id"
      label="Где будет доступно"
    />

    <div v-if="proposal.status === 'stale'" class="state-note stale">
      Элемент изменили после того, как агент подготовил предложение, поэтому применять его небезопасно.
      <button type="button" class="link" @click="$emit('discuss', `Элемент «${proposal.slug}» изменился. Перечитай его и подготовь предложение заново.`)">Попросить агента обновить</button>
    </div>
    <div v-else-if="proposal.status === 'applied'" class="state-note applied">
      ✓ Применено — элемент в списке инструкций и разложен по папкам агентов.
    </div>
    <div v-else-if="proposal.status === 'rejected'" class="state-note">Отклонено, библиотека не менялась.</div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="pending" class="actions">
      <AppButton size="sm" variant="primary" :disabled="busy || invalidWhere" @click="apply">{{ busy ? 'Применяю…' : 'Применить' }}</AppButton>
      <AppButton size="sm" variant="danger-ghost" :disabled="busy" @click="reject">Отклонить</AppButton>
      <AppButton size="sm" variant="ghost" :disabled="busy" @click="$emit('discuss', `По предложению «${proposal.slug}»: `)">Изменить в чате</AppButton>
      <span v-if="invalidWhere" class="hint">Выберите, где будет доступно.</span>
    </div>
  </div>
  <div v-else class="proposal missing">Предложение не найдено.</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@core/stores/app'
import { AvailabilityField, useProjectsStore, type Availability } from '@features/projects'
import type { LibraryProposal } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import { useLibraryStore } from '../stores/library'
import { diffLines, foldDiff } from '../utils/line-diff'

const props = defineProps<{ proposalId: string }>()
defineEmits<{ discuss: [text: string] }>()
const store = useLibraryStore(), projects = useProjectsStore(), app = useAppStore()
const proposal = computed<LibraryProposal | undefined>(() => store.proposals[props.proposalId])
const pending = computed(() => proposal.value?.status === 'pending')
const busy = ref(false), error = ref(''), editWhere = ref(false)

const STATUS: Record<LibraryProposal['status'], string> = { pending: 'ждёт решения', applied: 'применено', rejected: 'отклонено', stale: 'устарело' }
const TYPE: Record<LibraryProposal['type'], [string, string]> = { skill: ['Новый скилл', 'Изменение скилла'], command: ['Новая команда', 'Изменение команды'], main: ['Новый главный файл', 'Изменение главного файла'] }
const kindLabel = computed(() => proposal.value ? TYPE[proposal.value.type][proposal.value.action === 'create' ? 0 : 1] : '')

// A group's item proposed from one of its projects is applied as that project's own copy: the level is fixed.
const shared = computed(() => {
  const p = proposal.value, snap = p?.snapshot, project = projects.byId(p?.project_id)
  return !!snap && !!project?.group_id && snap.scope === 'project' && !snap.targets.includes(project.id) && snap.targets.includes(project.group_id)
})

const availability = ref<Availability>({ everywhere: false, targets: [] })
watch(() => proposal.value?.id, () => {
  const p = proposal.value
  if (p) availability.value = { everywhere: p.scope === 'global', targets: [...p.targets], ownOnly: [...p.own_only] }
  editWhere.value = false
}, { immediate: true })
const chosen = computed(() => ({
  scope: availability.value.everywhere ? 'global' as const : 'project' as const,
  targets: availability.value.everywhere ? [] : availability.value.targets,
  own_only: availability.value.everywhere ? [] : (availability.value.ownOnly ?? []).filter(id => availability.value.targets.includes(id)),
}))
const invalidWhere = computed(() => chosen.value.scope === 'project' && !chosen.value.targets.length)
const whereChanged = computed(() => {
  const p = proposal.value
  return !!p && (chosen.value.scope !== p.scope || chosen.value.targets.join() !== p.targets.join() || chosen.value.own_only.join() !== p.own_only.join())
})
const whereLabel = computed(() => {
  const { scope, targets, own_only } = chosen.value
  if (scope === 'global') return 'везде'
  return targets.map(id => {
    const t = projects.byId(id)
    if (!t) return '—'
    return t.kind === 'group' ? `группа «${t.name}»${own_only.includes(id) ? ' (только папка группы)' : ''}` : `проект «${t.name}»`
  }).join(', ') || '—'
})

// Metadata the developer should see next to the text: everything for a new item, only what changes otherwise.
const fields = computed(() => {
  const p = proposal.value
  if (!p) return []
  const fm = (v: Record<string, unknown> | undefined) => Object.keys(v ?? {}).length ? JSON.stringify(v) : ''
  const list = [
    { label: 'Название', after: p.title, before: p.snapshot?.title },
    { label: p.type === 'skill' ? 'Когда применять' : 'Описание', after: p.description, before: p.snapshot?.description },
    { label: 'Frontmatter', after: fm(p.frontmatter), before: p.snapshot ? fm(p.snapshot.frontmatter) : undefined },
  ]
  return p.snapshot
    ? list.filter(f => f.before !== f.after)
    : list.filter(f => f.after).map(f => ({ ...f, before: undefined }))
})

const lines = computed(() => proposal.value ? diffLines(proposal.value.snapshot?.content ?? '', proposal.value.content) : [])
const rows = computed(() => proposal.value?.action === 'create' ? lines.value : foldDiff(lines.value))
const stats = computed(() => ({ add: lines.value.filter(l => l.kind === 'add').length, del: lines.value.filter(l => l.kind === 'del').length }))
// Main is always in context, so its diff is shown open; a long new text starts folded.
const diffOpen = ref(proposal.value?.type === 'main' || proposal.value?.action === 'update' || lines.value.length <= 40)

function plural(n: number) {
  const d = n % 10, h = n % 100
  return d === 1 && h !== 11 ? 'строка' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'строки' : 'строк'
}

async function apply() {
  const p = proposal.value
  if (!p) return
  busy.value = true
  error.value = ''
  try {
    await store.applyProposal(p.id, whereChanged.value ? chosen.value : undefined)
    editWhere.value = false
    app.toast(`${TYPE[p.type][p.action === 'create' ? 0 : 1]} «${p.title}» применено`, 'success')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
async function reject() {
  busy.value = true
  error.value = ''
  try { await store.rejectProposal(props.proposalId) }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
</script>

<style scoped>
.proposal { padding: 12px 14px; background: var(--bg2); border: 1px solid var(--border); border-left: 3px solid var(--blue); border-radius: var(--radius); display: flex; flex-direction: column; gap: 10px; }
.proposal.main { border-left-color: var(--warning); }
.proposal.applied { border-left-color: var(--accent); }
.proposal.rejected, .proposal.stale { border-left-color: var(--border-strong); }
.proposal.rejected .diff, .proposal.rejected .fields { opacity: 0.6; }
.proposal.missing { font-size: 12px; color: var(--text-muted); border-left-color: var(--border-strong); }

.head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.kind { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.title { font-weight: 600; font-size: 13.5px; }
.slug { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-muted); }
.status { margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: var(--radius-pill); border: 1px solid var(--border); color: var(--text-muted); white-space: nowrap; }
.status.pending { color: var(--blue-hover); border-color: var(--blue-soft); background: var(--blue-soft); }
.status.applied { color: var(--accent-hover); border-color: var(--accent-soft); background: var(--accent-soft); }
.status.stale { color: var(--warning-text); border-color: var(--warning-soft); background: var(--warning-soft); }

.explanation { font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.main-note, .shared-note { font-size: 12px; line-height: 1.45; padding: 7px 10px; border-radius: var(--radius-sm); }
.main-note { background: var(--warning-soft); color: var(--warning-text); }
.shared-note { background: var(--blue-soft); color: var(--text-muted); }

.fields { display: flex; flex-direction: column; gap: 4px; }
.field { display: flex; gap: 10px; font-size: 12.5px; }
.field-label { flex: 0 0 120px; color: var(--text-muted); }
.field-value { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.field-value del { color: var(--danger-hover); opacity: 0.8; }

.diff summary { font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; }
.diff summary:hover { color: var(--text); }
.stat { display: inline-flex; gap: 6px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-weight: 500; }
.plus { color: var(--accent-hover); }
.minus { color: var(--danger-hover); }
.stat-none { font-weight: 400; color: var(--text-faint); }
.diff-body { margin-top: 6px; max-height: 420px; overflow: auto; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 0; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; }
.line { white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 10px 0 4px; }
.sign { display: inline-block; width: 16px; color: var(--text-faint); user-select: none; }
.line.add { background: var(--accent-soft); }
.line.add .sign { color: var(--accent-hover); }
.line.del { background: var(--danger-soft); }
.line.del .sign { color: var(--danger-hover); }
.line.skip { color: var(--text-faint); font-style: italic; padding: 2px 20px; }

.where { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px; }
.where-label { color: var(--text-muted); }
.availability { padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.link { background: none; border: none; padding: 0; font: inherit; font-size: 12px; color: var(--blue-hover); cursor: pointer; }
.link:hover { text-decoration: underline; }

.state-note { font-size: 12.5px; color: var(--text-muted); }
.state-note.stale { color: var(--warning-text); }
.state-note.applied { color: var(--accent-hover); }
.error { font-size: 12px; color: var(--danger-hover); overflow-wrap: anywhere; }
.actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hint { font-size: 11.5px; color: var(--text-faint); }
</style>
