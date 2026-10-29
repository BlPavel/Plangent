<template>
  <span v-if="!ordinary" class="where-fixed" title="Работа групп идёт в основных папках их проектов">📁 основные папки проектов</span>
  <span v-else ref="root" class="where" :class="{ open }">
    <button type="button" class="where-trigger" :class="{ invalid }" :title="invalid ? 'Укажите ветку' : 'Где работает агент'" @click="open = !open">
      ⎇ {{ label }}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <div v-if="open" class="where-pop" role="dialog" aria-label="Где работать" @keydown.esc.stop.prevent="open = false">
      <div class="where-kinds" role="group">
        <button type="button" :class="{ on: modelValue.place === 'new' }" @click="set({ place: 'new' })">Новая ветка</button>
        <button type="button" :class="{ on: modelValue.place === 'existing' }" @click="set({ place: 'existing' })">Существующая</button>
      </div>
      <template v-if="modelValue.place === 'new'">
        <p class="where-note">Своё рабочее место: другие агенты и основная папка проекта не мешают.</p>
        <label class="where-field"><span>Ветка</span>
          <BranchNameInput :model-value="modelValue.branch_name" :prefixes="prefixes" placeholder="Имя новой ветки" label="Имя новой ветки" @update:model-value="set({ branch_name: $event })" @enter="open = false" />
        </label>
        <label class="where-field"><span>от</span>
          <BranchSelect :model-value="modelValue.base_branch" :options="baseOptions" small placeholder="Из настроек проекта" label="Базовая ветка" @update:model-value="set({ base_branch: $event })" />
        </label>
      </template>
      <template v-else>
        <input ref="searchInput" v-model="search" class="control control-sm" placeholder="Поиск ветки (локальная или origin/*)" aria-label="Поиск ветки" />
        <div class="where-list">
          <template v-for="group in groups" :key="group.title">
            <div v-if="group.items.length" class="where-group">{{ group.title }}</div>
            <button
              v-for="b in group.items" :key="b.ref" type="button" class="where-item" :class="{ on: plain(b.name) === modelValue.branch }"
              :disabled="!!busy(b.name)" :title="busy(b.name) ? 'Занята: ' + busy(b.name) : plain(b.name) === current ? 'Открыта в основной папке: агент будет работать там' : 'Своё рабочее место на этой ветке'"
              @click="set({ branch: plain(b.name) }); open = false"
            >{{ b.name }}<span v-if="busy(b.name)" class="where-tag">занята</span><span v-else-if="plain(b.name) === current" class="where-tag main">основная папка</span></button>
          </template>
          <div v-if="!filtered.length" class="where-empty">Ветки не найдены</div>
        </div>
        <p v-if="modelValue.branch && modelValue.branch === current" class="where-note warn">
          Ветка открыта в основной папке — агент будет работать там. Одновременно в ней может идти только одна работа.<template v-if="dirty"> Там есть незакоммиченные изменения: агент будет работать поверх них.</template>
        </p>
      </template>
      <div v-if="error" class="where-error">{{ error }}</div>
    </div>
  </span>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { gitApi, codeApi, type GitBranch } from '@features/code'

export interface WorkPlace { place: 'new' | 'existing'; branch_name: string; base_branch: string; branch: string }
const props = defineProps<{ modelValue: WorkPlace; projectId: string; ordinary: boolean; /** branch → the work that already has it */ taken: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [WorkPlace] }>()
const root = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
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
watch(() => props.modelValue.place, async place => { if (open.value && place === 'existing') { await nextTick(); searchInput.value?.focus() } })
// Refreshed from origin when the list is opened: a colleague may have pushed a branch since.
watch(open, async value => {
  if (!value || !props.ordinary) return
  try { const refs = await gitApi.refreshBranches(props.projectId); if (open.value) branches.value = refs } catch { /* the cached list stays */ }
})
function outside(event: PointerEvent) { if (open.value && root.value && !root.value.contains(event.target as Node) && !(event.target as Element).closest?.('.bsel-list')) open.value = false }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
defineExpose({ invalid, openPicker: () => { open.value = true } })
</script>
<style scoped>
.where { position: relative; display: inline-flex; }
.where-fixed { font-size: 12px; color: var(--text-muted); padding: 0 6px; white-space: nowrap; }
.where-trigger { display: inline-flex; align-items: center; gap: 6px; max-width: 320px; height: var(--size-sm); padding: 0 8px 0 10px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: var(--radius-btn); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.where-trigger:hover, .where.open .where-trigger { color: var(--text); background: var(--bg3); border-color: var(--border-strong); }
.where-trigger.invalid { color: var(--warning-text); }
.where-trigger svg { width: 12px; height: 12px; flex-shrink: 0; }
.where-pop { position: absolute; z-index: 30; top: calc(100% + 6px); right: 0; width: 380px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); font-size: 12px; }
.where-kinds { display: inline-flex; align-self: flex-start; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.where-kinds button { padding: 4px 12px; font: inherit; color: var(--text-muted); background: none; border: none; cursor: pointer; }
.where-kinds button.on { background: var(--bg3); color: var(--text); }
.where-note { margin: 0; font-size: 11.5px; line-height: 1.4; color: var(--text-faint); }
.where-note.warn { color: var(--warning-text); }
.where-field { display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); }
.where-list { max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
.where-group { padding: 4px 6px 2px; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.where-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; overflow-wrap: anywhere; }
.where-item:hover:not(:disabled) { background: var(--bg-hover); }
.where-item.on { background: var(--blue-soft); }
.where-item:disabled { color: var(--text-faint); cursor: not-allowed; }
.where-tag { margin-left: auto; flex-shrink: 0; font-size: 10.5px; color: var(--text-faint); }
.where-tag.main { color: var(--warning-text); }
.where-empty { padding: 6px 8px; color: var(--text-muted); }
.where-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
