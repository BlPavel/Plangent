<template>
  <span v-if="!ordinary" class="where-fixed" title="Работа групп идёт в основных папках их проектов">📁 основные папки проектов</span>
  <span v-else ref="root" class="where" :class="{ open, inline }">
    <AppButton v-if="!inline" variant="subtle" size="sm" :pressed="open" :aria-expanded="open" aria-haspopup="dialog" :title="invalid ? 'Выберите ветку выполнения' : 'Ветка выполнения: ' + label" @click="open = !open">
      <UIIconGitBranch class="where-branch-icon" />
      <span class="where-trigger-text">{{ label }}</span>
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
        <label class="where-field"><span>Ветка проекта</span>
          <BranchSelect block :model-value="modelValue.branch" :options="existingOptions" small placeholder="Выберите ветку" label="Существующая ветка" :allow-custom="false" empty-label="Ветки не найдены" @update:model-value="set({ branch: $event })" />
        </label>
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
import { IconGitBranch as UIIconGitBranch } from '@shared/ui/icons'
import { IconChevron as UIIconChevron } from '@shared/ui/icons'
import { computed, ref, watch } from 'vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { AppButton, AppPopover, AppSegmented } from '@shared/ui'
import { gitApi, codeApi, type GitBranch } from '@features/code'

export interface WorkPlace { place: 'new' | 'existing'; branch_name: string; base_branch: string; branch: string }
const props = defineProps<{ modelValue: WorkPlace; projectId: string; ordinary: boolean; inline?: boolean; /** branch → the work that already has it */ taken: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [WorkPlace] }>()
const root = ref<HTMLElement>()
const open = ref(false), error = ref('')
const branches = ref<GitBranch[]>([]), prefixes = ref<string[]>([]), current = ref(''), dirty = ref(false)
const set = (patch: Partial<WorkPlace>) => emit('update:modelValue', { ...props.modelValue, ...patch })
const plain = (name: string) => name.replace(/^origin\//, '')
const busy = (name: string) => props.taken[plain(name)] ?? ''
/** Existing branches, local first; one that another work holds is listed but cannot be picked. */
const existingOptions = computed(() => {
  const seen = new Set<string>()
  return [...branches.value.filter(b => !b.remote), ...branches.value.filter(b => b.remote)].flatMap(b => {
    const name = plain(b.name)
    if (name === 'HEAD' || seen.has(name)) return []
    seen.add(name)
    const note = busy(name) ? ' · занята: ' + busy(name) : name === current.value ? ' · основная папка' : ''
    return [{ value: name, label: name + note, disabled: !!busy(name) }]
  })
})
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
.where-trigger-text { min-width: 0; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); line-height: var(--lh-normal); }
.where-branch-icon { width: 16px; height: 16px; flex-shrink: 0; color: var(--blue-hover); }
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
.where-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
