<template>
  <div ref="root" class="branches" role="dialog" aria-label="Ветки" @keydown.esc.stop.prevent="emit('close')">
    <input ref="searchInput" v-model="search" class="control control-sm" placeholder="Поиск ветки (локальная или origin/*)" aria-label="Поиск ветки" @keydown.enter.prevent="pickFirst" />
    <div class="list">
      <template v-for="group in groups" :key="group.title">
        <div v-if="group.items.length" class="group-title">{{ group.title }}</div>
        <button
          v-for="branch in group.items" :key="branch.ref" type="button" class="item" :class="{ current: branch.name === current, base: branch.name === base }"
          :disabled="!!git.blocked || branch.name === current" :title="branch.remote ? 'Выбрать как основу для новой ветки' : branch.name === current ? 'Текущая ветка' : 'Переключиться'" @click="pick(branch)"
        >{{ branch.name }}<span v-if="branch.name === current" class="tag">текущая</span></button>
      </template>
      <div v-if="!filtered.length" class="muted empty">Ветки не найдены</div>
    </div>
    <form class="create" @submit.prevent="create">
      <div class="group-title">Новая ветка</div>
      <input ref="nameInput" v-model="name" class="control control-sm" placeholder="Имя новой ветки" aria-label="Имя новой ветки" />
      <label class="from">от
        <select v-model="base" class="control control-sm" aria-label="От ветки"><option v-for="branch in git.branches" :key="branch.ref" :value="branch.name">{{ branch.name }}</option></select>
      </label>
      <div v-if="error" role="alert" class="error">{{ error }}</div>
      <div class="actions">
        <span class="muted hint">Esc — закрыть</span>
        <button type="button" class="btn btn-subtle btn-sm" @click="emit('close')">Закрыть</button>
        <button type="submit" class="btn btn-blue btn-sm" :disabled="!name.trim() || !base || !!git.blocked" :title="git.blocked">Создать и переключиться</button>
      </div>
    </form>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useGitStore } from '../stores/git'
import type { GitBranch } from '../git-types'
const props = defineProps<{ task?: { key: string } | null }>()
const emit = defineEmits<{ close: [] }>()
const git = useGitStore(), search = ref(''), name = ref(''), base = ref(git.repository?.branch ?? ''), error = ref('')
const root = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>(), nameInput = ref<HTMLInputElement>()
const current = computed(() => git.repository?.detached ? '' : git.repository?.branch ?? '')
const filtered = computed(() => git.branches.filter(b => b.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const groups = computed(() => [{ title: 'Локальные', items: filtered.value.filter(b => !b.remote) }, { title: 'origin', items: filtered.value.filter(b => b.remote) }])
watch(() => git.settings, prefs => { if (!name.value && prefs) name.value = prefs.branch_template.replaceAll('{key}', props.task?.key ?? '').replaceAll('{slug}', 'work') }, { immediate: true })
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
function pickFirst() { const first = filtered.value.find(b => b.name !== current.value); if (first) void pick(first) }
async function pick(branch: GitBranch) {
  error.value = ''
  // A remote branch is not checked out directly: it becomes the base of a new local branch.
  if (branch.remote) { base.value = branch.name; nameInput.value?.focus(); return }
  try { await git.run('switch', { branch: branch.name }); emit('close') } catch (cause) { error.value = message(cause) }
}
async function create() { error.value = ''; try { await git.run('branch', { name: name.value.trim(), base: base.value }); emit('close') } catch (cause) { error.value = message(cause) } }
function outside(event: PointerEvent) { if (root.value && !root.value.contains(event.target as Node) && !(event.target as Element).closest?.('.gh-branch')) emit('close') }
onMounted(() => { searchInput.value?.focus(); document.addEventListener('pointerdown', outside) })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<style scoped>
.branches { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 380px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); font-size: 12px; }
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
.error { color: var(--danger-hover); overflow-wrap: anywhere; }
.hint { flex: 1; font-size: 11px; color: var(--text-faint); }
</style>
