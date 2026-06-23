<template>
  <div class="lib">
    <div class="lib-header">
      <div class="lib-tabs">
        <button
          v-for="t in typeOptions"
          :key="t.value"
          class="tab-btn"
          :class="{ active: filterType === t.value }"
          @click="filterType = t.value; reload()"
        >{{ t.label }}</button>
      </div>
      <div class="lib-actions">
        <button class="btn btn-ghost btn-sm" :disabled="syncing" @click="doSync">
          {{ syncing ? '...' : '↻ Синк' }}
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ Добавить</button>
      </div>
    </div>

    <label v-if="scope === 'project' && project" class="git-toggle">
      <input type="checkbox" :checked="!project.hide_from_git" @change="toggleGitVisibility" />
      <span>
        Включать созданные файлы в git
        <span class="git-hint">
          {{ project.hide_from_git
            ? 'Скрыты через .git/info/exclude (локально, не пушится).'
            : 'Видны в git status.' }}
        </span>
      </span>
    </label>

    <div class="item-list">
      <div v-if="store.loading" class="muted-msg">Загрузка...</div>
      <div v-else-if="!store.items.length" class="muted-msg">
        Нет элементов. Нажмите «+ Добавить».
      </div>
      <div v-for="item in store.items" :key="item.id" class="item-row">
        <div class="item-main">
          <label class="toggle" :title="item.enabled ? 'Включён' : 'Выключен'">
            <input type="checkbox" :checked="item.enabled" @change="toggleEnabled(item)" />
            <span class="toggle-slider"></span>
          </label>
          <div class="item-text">
            <span class="item-title">{{ item.title }}</span>
            <span class="item-slug">{{ item.slug }}</span>
            <span v-if="item.description" class="item-desc">{{ item.description }}</span>
          </div>
          <div class="item-badges">
            <span class="badge">{{ typeLabel(item.type) }}</span>
            <span v-if="item.agent_filter.length" class="badge">{{ item.agent_filter.join(', ') }}</span>
          </div>
        </div>
        <div class="item-btns">
          <button class="btn btn-ghost btn-sm" @click="openEdit(item)">Изменить</button>
          <button class="btn btn-danger btn-sm" @click="removeItem(item.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <AppModal
      v-model="showModal"
      :title="editItem ? 'Изменить' : 'Добавить элемент'"
      confirm-label="Сохранить"
      size="large"
      @confirm="save"
    >
      <LibraryItemForm ref="formRef" :form="form" :agents="agentsStore.agents" :is-edit="!!editItem" :existing-main-id="existingMainId" />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useLibraryStore } from '../stores/library'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useProjectsStore } from '@features/projects'
import type { LibraryItem, LibraryItemType, LibraryScope } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import LibraryItemForm from './LibraryItemForm.vue'

const props = defineProps<{ scope: LibraryScope; projectId?: string }>()
const scope = computed(() => props.scope)

const store = useLibraryStore()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()
const project = computed(() => props.projectId ? projectsStore.projects.find(p => p.id === props.projectId) ?? null : null)

const filterType = ref<LibraryItemType | ''>('')
const syncing = ref(false)

const typeOptions = [
  { value: '' as const, label: 'Все' },
  { value: 'skill' as LibraryItemType, label: 'Скиллы' },
  { value: 'command' as LibraryItemType, label: 'Команды' },
  { value: 'main' as LibraryItemType, label: 'Главный файл' },
]

function typeLabel(t: LibraryItemType) {
  return { skill: 'скилл', command: 'команда', main: 'main' }[t]
}

async function reload() {
  await store.load({
    type: filterType.value || undefined,
    scope: scope.value,
    projectId: scope.value === 'project' ? props.projectId : undefined,
  })
}

onMounted(() => {
  reload()
  agentsStore.load()
  if (scope.value === 'project' && !projectsStore.projects.length) projectsStore.load()
})
watch(() => props.projectId, reload)

async function doSync() {
  syncing.value = true
  try { await store.syncAll(); appStore.toast('Синхронизировано', 'success') }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
  finally { syncing.value = false }
}

async function toggleGitVisibility(e: Event) {
  if (!project.value) return
  const hide = !(e.target as HTMLInputElement).checked
  try {
    await projectsStore.update(project.value.id, { hide_from_git: hide })
    await store.syncAll()
    appStore.toast(hide ? 'Файлы скрыты от git' : 'Файлы включены в git', 'success')
  } catch (err: unknown) { appStore.toast(String(err), 'error') }
}

async function toggleEnabled(item: LibraryItem) {
  try { await store.update(item.id, { enabled: !item.enabled }) }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function removeItem(id: string) {
  if (!confirm('Удалить?')) return
  try { await store.remove(id); appStore.toast('Удалено', 'success') }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
}

const showModal = ref(false)
const editItem = ref<LibraryItem | null>(null)
const defaultForm = () => ({ type: 'skill' as LibraryItemType, slug: '', title: '', description: '', agent_filter: [] as string[], disableModelInvocation: false, content: '' })
const form = ref(defaultForm())

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `item_${Date.now()}`
}

const formRef = ref<InstanceType<typeof LibraryItemForm> | null>(null)
const existingMainId = ref<string | null>(null)

async function openCreate() {
  editItem.value = null
  existingMainId.value = await store.findMainId(scope.value, scope.value === 'project' ? props.projectId : undefined)
  const wanted = (filterType.value as LibraryItemType) || 'skill'
  form.value = { ...defaultForm(), type: wanted === 'main' && existingMainId.value ? 'skill' : wanted }
  showModal.value = true
}

async function openEdit(item: LibraryItem) {
  editItem.value = item
  existingMainId.value = null
  const full = await store.getItem(item.id)
  form.value = {
    type: item.type,
    slug: item.slug,
    title: item.title,
    description: item.description,
    agent_filter: [...item.agent_filter],
    disableModelInvocation: !!item.frontmatter['disable-model-invocation'],
    content: full.content ?? '',
  }
  showModal.value = true
}

async function save() {
  if (formRef.value && !formRef.value.validate()) return

  const isMain = form.value.type === 'main'
  if (isMain && !editItem.value && existingMainId.value) {
    appStore.toast('Главный файл для этого уровня уже существует', 'error')
    return
  }

  const agentFilter = form.value.agent_filter
  const frontmatter: Record<string, unknown> = {}
  if (form.value.disableModelInvocation) frontmatter['disable-model-invocation'] = true

  const slug = editItem.value
    ? form.value.slug
    : isMain ? 'main' : slugify(form.value.title)
  const title = isMain ? (form.value.title.trim() || 'Главный файл') : form.value.title.trim()

  const payload = {
    type: form.value.type,
    slug,
    title,
    description: form.value.description.trim(),
    scope: scope.value,
    project_id: scope.value === 'project' ? (props.projectId ?? null) : null,
    frontmatter,
    agent_filter: agentFilter,
    content: form.value.content,
  }

  try {
    if (editItem.value) {
      await store.update(editItem.value.id, payload)
      appStore.toast('Сохранено', 'success')
    } else {
      await store.create(payload as Parameters<typeof store.create>[0])
      appStore.toast('Создано', 'success')
    }
    showModal.value = false
    reload()
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}
</script>

<style scoped>
.lib { display: flex; flex-direction: column; gap: 12px; height: 100%; }

.lib-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lib-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.lib-actions { display: flex; gap: 6px; flex-shrink: 0; }

.tab-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.1s;
}
.tab-btn.active { background: var(--bg3); color: var(--text); border-color: var(--blue); }

.git-toggle {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; color: var(--text); cursor: pointer;
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 7px 10px;
}
.git-toggle input { margin-top: 2px; }
.git-hint { display: block; font-size: 10px; color: var(--text-muted); opacity: 0.75; margin-top: 1px; }

.item-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1; }
.muted-msg { color: var(--text-muted); font-size: 13px; padding: 8px 0; }

.item-row {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.item-main { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.item-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.item-title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-slug { font-size: 11px; color: var(--text-muted); font-family: monospace; }
.item-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-badges { display: flex; gap: 4px; flex-shrink: 0; }
.badge { font-size: 10px; padding: 2px 6px; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); }
.item-btns { display: flex; gap: 6px; flex-shrink: 0; }

/* Toggle */
.toggle { position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer; flex-shrink: 0; }
.toggle input { display: none; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: 18px; transition: background 0.2s; }
.toggle-slider::before { content: ''; position: absolute; width: 12px; height: 12px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: transform 0.2s; }
.toggle input:checked + .toggle-slider { background: var(--blue); }
.toggle input:checked + .toggle-slider::before { transform: translateX(14px); }
</style>
