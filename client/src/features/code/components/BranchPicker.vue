<template>
  <div ref="root" class="branches" :class="{ up }" role="dialog" aria-label="Ветки" @keydown.esc.stop.prevent="emit('close')">
    <input ref="searchInput" v-model="search" class="control control-sm" placeholder="Поиск ветки (локальная или origin/*)" aria-label="Поиск ветки" @keydown.enter.prevent="pickFirst" />
    <button type="button" class="btn btn-subtle btn-sm" :disabled="refreshing" @click="refreshBranches">{{ refreshing ? 'Обновление из origin…' : 'Обновить ветки из origin' }}</button>
    <div class="list">
      <template v-for="group in groups" :key="group.title">
        <div v-if="group.items.length" class="group-title">{{ group.title }}</div>
        <button
          v-for="branch in group.items" :key="branch.ref" type="button" class="item" :class="{ current: branch.name === current, base: branch.name === base }"
          :disabled="!!git.writeBlocked || selecting || (branch.name === current && !onSelectBranch)" :title="git.writeBlocked || (branch.remote ? 'Переключиться на ветку из origin' : branch.name === current ? 'Текущая ветка' : 'Переключиться')" @click="pick(branch)"
        >{{ branch.name }}<span v-if="branch.name === current" class="tag">текущая</span></button>
      </template>
      <div v-if="!filtered.length" class="muted empty">Ветки не найдены</div>
    </div>
    <form class="create" @submit.prevent="create">
      <div class="group-title">Новая ветка</div>
      <BranchNameInput v-model="name" :prefixes="prefixes" placeholder="Имя новой ветки" label="Имя новой ветки" />
      <label class="from">от
        <BranchSelect v-model="base" :options="baseOptions" small placeholder="Ветка-источник" label="От ветки" />
      </label>
      <div v-if="error" role="alert" class="error">{{ error }}</div>
      <div class="actions">
        <span class="muted hint">Esc — закрыть</span>
        <button type="button" class="btn btn-subtle btn-sm" @click="emit('close')">Закрыть</button>
        <button type="submit" class="btn btn-blue btn-sm" :disabled="selecting || !name.trim() || name.endsWith('/') || !base || !!git.writeBlocked" :title="git.writeBlocked">Создать и переключиться</button>
      </div>
    </form>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { useGitStore } from '../stores/git'
import type { GitBranch } from '../git-types'
const props = defineProps<{ task?: { key: string } | null; /** open above the trigger (the branch row sits at the bottom) */ up?: boolean; onSelectBranch?: (branch: string) => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const git = useGitStore(), search = ref(''), name = ref(''), base = ref(git.repository?.branch ?? ''), error = ref('')
const refreshing = ref(false)
const selecting = ref(false)
let disposed = false
const root = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
const current = computed(() => git.repository?.detached ? '' : git.repository?.branch ?? '')
const filtered = computed(() => git.branches.filter(b => b.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const groups = computed(() => [{ title: 'Локальные', items: filtered.value.filter(b => !b.remote) }, { title: 'origin', items: filtered.value.filter(b => b.remote) }])
const baseOptions = computed(() => git.branches.map(b => ({ value: b.name, label: b.name })))
const prefixes = computed(() => git.settings?.branch_prefixes ?? [])
watch(() => git.settings, (prefs, previous) => {
  if (!prefs || previous) return
  if (!name.value && prefs.branch_prefixes[0]) name.value = prefs.branch_prefixes[0] + '/' + (props.task?.key ?? '')
  // New branches start from the project's base branch when it exists here.
  if (prefs.base_branch && git.branches.some(b => b.name === prefs.base_branch)) base.value = prefs.base_branch
}, { immediate: true })
const message = (cause: unknown) => {
  const text = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
  const output = (cause as { output?: string } | null)?.output?.trim()
  return output ? text + '\n' + output : text
}
function pickFirst() { const first = filtered.value.find(b => props.onSelectBranch || b.name !== current.value); if (first) void pick(first) }
async function pick(branch: GitBranch) {
  if (selecting.value || git.writeBlocked) return
  selecting.value = true
  error.value = ''
  try {
    if (branch.name !== current.value) await git.run('switch', { branch: branch.name })
    await props.onSelectBranch?.(branch.name)
    emit('close')
  } catch (cause) { error.value = message(cause) }
  finally { selecting.value = false }
}
async function create() {
  if (selecting.value || git.writeBlocked) return
  selecting.value = true; error.value = ''
  const branch = name.value.trim()
  try {
    await git.run('branch', { name: branch, base: base.value })
    await props.onSelectBranch?.(branch)
    emit('close')
  } catch (cause) { error.value = message(cause) }
  finally { selecting.value = false }
}
function outside(event: PointerEvent) { if (root.value && !root.value.contains(event.target as Node) && !(event.target as Element).closest?.('.bb-branch')) emit('close') }
async function refreshBranches() {
  if (refreshing.value) return
  const projectId = git.projectId
  refreshing.value = true; error.value = ''
  try {
    const refs = await git.refreshBranches()
    if (!disposed && projectId === git.projectId) git.branches = refs
  } catch (cause) { if (!disposed) error.value = message(cause) }
  finally { if (!disposed) refreshing.value = false }
}
onMounted(() => { searchInput.value?.focus(); document.addEventListener('pointerdown', outside); void refreshBranches() })
onBeforeUnmount(() => { disposed = true; document.removeEventListener('pointerdown', outside) })
</script>
<style scoped>
.branches { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 380px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); font-size: 12px; }
.branches.up { top: auto; bottom: calc(100% + 4px); }
.list { max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
.group-title { padding: 4px 6px 2px; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); }
.item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; overflow-wrap: anywhere; }
.item:hover:not(:disabled) { background: var(--bg-hover); }
.item:disabled { cursor: default; }
.item.current { color: var(--text-muted); }
.item.base { background: var(--blue-soft); }
.tag { margin-left: auto; font-size: 10.5px; color: var(--text-faint); }
.empty { padding: 6px 8px; }
.create { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
.from { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.from select { flex: 1; min-width: 0; }
.error { color: var(--danger-hover); overflow-wrap: anywhere; white-space: pre-wrap; max-height: 160px; overflow: auto; }
.hint { flex: 1; font-size: 11px; color: var(--text-faint); }
</style>
