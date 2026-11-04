<template>
  <span v-if="!ordinary" class="where-fixed" title="Работа групп идёт в основных папках их проектов">📁 основные папки проектов</span>
  <span v-else ref="root" class="where" :class="{ open, inline }">
    <AppButton v-if="!inline" variant="subtle" size="sm" :pressed="open" :aria-expanded="open" aria-haspopup="dialog" :title="invalid ? 'Выберите ветку выполнения' : label" @click="open = !open">
      <UIIconGitBranch class="where-branch-icon" />
      <span class="where-trigger-text"><span>Ветка выполнения</span><strong>{{ label }}</strong></span>
      <UIIconChevron />
    </AppButton>
    <AppPopover :model-value="open || !!inline" :inline="inline" :anchor="root" :min-width="360" :role="inline ? 'group' : 'dialog'" label="Где работать" @update:model-value="open = $event">
      <div class="where-content">
      <AppSegmented :model-value="modelValue.place" :options="[{ value: 'new', label: 'Создать новую' }, { value: 'existing', label: 'Использовать существующую' }]" label="Способ выбора ветки" @update:model-value="set({ place: $event as 'new' | 'existing' })" />
      <template v-if="modelValue.place === 'new'">
        <label class="where-field"><span>Имя новой ветки</span>
          <BranchNameInput :model-value="modelValue.branch_name" :prefixes="prefixes" placeholder="Имя новой ветки" label="Имя новой ветки" @update:model-value="set({ branch_name: $event })" @enter="open = false" />
        </label>
        <label class="where-field"><span>Создать от ветки</span>
          <BranchSelect :model-value="modelValue.base_branch" :options="baseOptions" small placeholder="Из настроек проекта" label="Базовая ветка" @update:model-value="set({ base_branch: $event })" />
        </label>
        <p class="where-note">Для задачи будет создана отдельная рабочая папка на новой ветке.</p>
      </template>
      <template v-else>
        <label class="where-field"><span>Найти ветку проекта</span><AppInput ref="searchInput" v-model="search" size="sm" placeholder="Введите название ветки…" aria-label="Поиск ветки" /></label>
        <div v-if="modelValue.branch" class="where-selection"><span>Выбрана ветка</span><code>{{ modelValue.branch }}</code></div>
        <div class="where-list">
          <template v-for="group in groups" :key="group.title">
            <div v-if="group.items.length" class="where-group">{{ group.title }}</div>
            <AppButton
              v-for="b in group.items" :key="b.ref" variant="subtle" size="sm" block :pressed="plain(b.name) === modelValue.branch"
              :disabled="!!busy(b.name)" :title="busy(b.name) ? 'Занята: ' + busy(b.name) : plain(b.name) === current ? 'Открыта в основной папке: агент будет работать там' : 'Своё рабочее место на этой ветке'"
              @click="set({ branch: plain(b.name) }); open = false"
            ><span class="where-item-check" aria-hidden="true">{{ plain(b.name) === modelValue.branch ? '✓' : '⎇' }}</span><span class="where-item-name">{{ b.name }}</span><AppBadge v-if="busy(b.name)" >занята</AppBadge><AppBadge v-else-if="plain(b.name) === current" >основная папка</AppBadge></AppButton>
          </template>
          <div v-if="!filtered.length" class="where-empty">Ветки не найдены</div>
        </div>
        <p v-if="modelValue.branch && modelValue.branch === current" class="where-note warn">
          Ветка открыта в основной папке — агент будет работать там. Одновременно в ней может идти только одна работа.<template v-if="dirty"> Там есть незакоммиченные изменения: агент будет работать поверх них.</template>
        </p>
        <p v-else-if="modelValue.branch" class="where-note">Агент будет работать в отдельной рабочей папке на выбранной ветке.</p>
      </template>
      <div v-if="error" class="where-error">{{ error }}</div>
      </div>
    </AppPopover>
  </span>
</template>
<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import { IconGitBranch as UIIconGitBranch } from '@shared/ui/icons'
import { IconChevron as UIIconChevron } from '@shared/ui/icons'
import { computed, nextTick, ref, watch } from 'vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { AppButton, AppInput, AppPopover, AppSegmented } from '@shared/ui'
import { gitApi, codeApi, type GitBranch } from '@features/code'

export interface WorkPlace { place: 'new' | 'existing'; branch_name: string; base_branch: string; branch: string }
const props = defineProps<{ modelValue: WorkPlace; projectId: string; ordinary: boolean; inline?: boolean; /** branch → the work that already has it */ taken: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [WorkPlace] }>()
const root = ref<HTMLElement>(), searchInput = ref<InstanceType<typeof AppInput>>()
const open = ref(false), search = ref(''), error = ref('')
const branches = ref<GitBranch[]>([]), prefixes = ref<string[]>([]), current = ref(''), dirty = ref(false)
const set = (patch: Partial<WorkPlace>) => emit('update:modelValue', { ...props.modelValue, ...patch })
const plain = (name: string) => name.replace(/^origin\//, '')
const busy = (name: string) => props.taken[plain(name)] ?? ''
const filtered = computed(() => branches.value.filter(b => b.name.toLowerCase().includes(search.value.trim().toLowerCase()) && plain(b.name) !== 'HEAD'))
const groups = computed(() => [{ title: 'Локальные', items: filtered.value.filter(b => !b.remote) }, { title: 'origin', items: filtered.value.filter(b => b.remote) }])
const baseOptions = computed(() => [...new Set(branches.value.filter(b => b.remote).map(b => plain(b.name)))].filter(n => n !== 'HEAD').map(n => ({ value: n, label: 'origin/' + n })))
const invalid = computed(() => props.modelValue.place === 'new' ? !props.modelValue.branch_name.trim() || props.modelValue.branch_name.endsWith('/') : !props.modelValue.branch)
const label = computed(() => {
  const v = props.modelValue
  if (v.place === 'existing') return v.branch ? v.branch + (v.branch === current.value ? ' · основная папка' : '') : 'выберите ветку'
  const name = v.branch_name && !v.branch_name.endsWith('/') ? v.branch_name : 'новая ветка'
  return name + ' от ' + (v.base_branch || 'базовой')
})

// The project's branches, prefixes and base branch, as the «Код» tab shows them; the main folder's branch and its edits.
watch(() => [props.projectId, props.ordinary], async () => {
  if (!props.ordinary) return
  const id = props.projectId
  try {
    const [refs, settings, repository, changes] = await Promise.all([gitApi.branches(id), gitApi.settings(id), gitApi.repository(id), codeApi.changes(id).catch(() => [])])
    if (id !== props.projectId) return
    branches.value = refs; prefixes.value = settings.branch_prefixes
    current.value = repository?.detached ? '' : repository?.branch ?? ''
    dirty.value = changes.length > 0
    const remote = refs.filter(b => b.remote).map(b => plain(b.name))
    const patch: Partial<WorkPlace> = {}
    if (!props.modelValue.base_branch) patch.base_branch = settings.base_branch || ['main', 'master'].find(n => remote.includes(n)) || ''
    if (!props.modelValue.branch_name && settings.branch_prefixes[0]) patch.branch_name = settings.branch_prefixes[0] + '/'
    if (Object.keys(patch).length) set(patch)
  } catch (cause) { error.value = 'Не удалось получить ветки: ' + (cause instanceof Error ? cause.message : String(cause)) }
}, { immediate: true })
watch(open, async value => {
  if (!value || props.modelValue.place !== 'existing') return
  await nextTick(); searchInput.value?.focus()
})
watch(() => props.modelValue.place, async place => { if ((open.value || props.inline) && place === 'existing') { await nextTick(); searchInput.value?.focus() } })
// Refreshed from origin when the list is opened: a colleague may have pushed a branch since.
watch(open, async value => {
  if (!value || !props.ordinary) return
  try { const refs = await gitApi.refreshBranches(props.projectId); if (open.value) branches.value = refs } catch { /* the cached list stays */ }
})
defineExpose({ invalid, openPicker: () => { open.value = true } })
</script>
<style scoped>
.where { position: relative; display: inline-flex; }
.where.inline { display: block; }
.where-content { display: flex; flex-direction: column; gap: 14px; padding: var(--sp-2); }
.where-fixed { font-size: var(--fs-sm); color: var(--text-muted); padding: 0 6px; white-space: nowrap; }
.where-trigger { display: inline-flex; align-items: center; gap: 10px; max-width: min(380px, 100%); padding: 8px 10px; font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-btn); cursor: pointer; text-align: left; }
.where-trigger-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.where-trigger-text > span { color: var(--text-muted); font-size: var(--fs-xs); }
.where-trigger-text strong { font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.where-trigger:hover, .where.open .where-trigger { color: var(--text); background: var(--bg3); border-color: var(--border-strong); }
.where-trigger.invalid { color: var(--warning-text); }
.where-trigger svg { width: 12px; height: 12px; flex-shrink: 0; }
.where-trigger .where-branch-icon { width: 18px; height: 18px; color: var(--blue-hover); }
.where-pop { position: absolute; z-index: var(--z-field-popover); top: calc(100% + 6px); right: 0; width: min(440px, calc(100vw - 40px)); max-height: min(560px, 70vh); overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); font-size: var(--fs-sm); }
.where-pop.inline { max-height: none; overflow: visible; }
.where-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.where-kinds button { display: flex; flex-direction: column; gap: 5px; padding: 12px; font: inherit; text-align: left; color: var(--text-muted); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); cursor: pointer; }
.where-kinds button strong { font-size: var(--fs-sm); font-weight: 600; color: var(--text); }
.where-kinds button span { font-size: var(--fs-xs); line-height: 1.45; }
.where-kinds button.on { background: var(--blue-soft); border-color: var(--blue-hover); box-shadow: inset 0 0 0 1px var(--blue-hover); }
.where-kinds button:hover { border-color: var(--blue-hover); }
.where-note { margin: 0; font-size: var(--fs-sm); line-height: 1.55; color: var(--text-muted); }
.where-note.warn { color: var(--warning-text); }
.where-field { display: flex; flex-direction: column; gap: 7px; color: var(--text); font-size: var(--fs-sm); }
.where-selection { display: flex; flex-wrap: wrap; gap: 6px 10px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--blue-soft); color: var(--text-muted); }
.where-selection code { color: var(--text); overflow-wrap: anywhere; }
.where-list { max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
.where-group { padding: 4px 6px 2px; font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.where-item { display: flex; align-items: center; gap: 8px; padding: 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; overflow-wrap: anywhere; }
.where-item-check { width: 14px; flex-shrink: 0; color: var(--blue-hover); }
.where-item-name { min-width: 0; overflow-wrap: anywhere; }
.where-item:hover:not(:disabled) { background: var(--bg-hover); }
.where-item.on { background: var(--blue-soft); }
.where-item:disabled { color: var(--text-faint); cursor: not-allowed; }
.where-tag { margin-left: auto; flex-shrink: 0; font-size: var(--fs-xs); color: var(--text-faint); }
.where-tag.main { color: var(--warning-text); }
.where-empty { padding: 6px 8px; color: var(--text-muted); }
.where-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
