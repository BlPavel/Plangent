<template>
  <div class="lib">
    <div class="lib-header">
      <div v-if="scope !== 'global'" class="lib-tabs">
        <button
          v-for="t in typeOptions"
          :key="t.value"
          class="tab-btn"
          :class="{ active: filterType === t.value }"
          @click="filterType = t.value; reload()"
        >{{ t.label }}</button>
      </div>
      <div class="lib-actions">
        <AppButton variant="ghost" size="sm" :disabled="syncing" @click="doSync">
          {{ syncing ? '...' : '↻ Синк' }}
        </AppButton>
        <AppButton variant="primary" size="sm" @click="openCreate">+ Добавить</AppButton>
      </div>
    </div>

    <label v-if="scope === 'project' && project?.kind === 'project'" class="git-toggle">
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
            <span v-if="item.detached_from" class="badge badge-where" title="Отвязан от общего скилла группы: живёт только в этом проекте">свой для проекта</span>
            <span v-if="availabilityLabel(item)" class="badge badge-where" :title="availabilityTitle(item)">{{ availabilityLabel(item) }}</span>
            <span v-if="item.agent_filter.length" class="badge">{{ item.agent_filter.join(', ') }}</span>
          </div>
        </div>
        <div class="item-btns">
          <AppButton v-if="item.detached_from" variant="ghost" size="sm" title="Вернуть общую версию из группы" @click="reattach(item)">К общему</AppButton>
          <AppButton variant="ghost" size="sm" @click="openEdit(item)">Изменить</AppButton>
          <AppButton variant="danger-ghost" size="sm" icon title="Удалить" @click="removeItem(item)">
            <IconTrash />
          </AppButton>
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
      <p v-if="editingShared" class="shared-note">Этот элемент общий, из группы. Изменения сохранятся только для этого проекта: он получит свою копию, а у группы и других проектов всё останется как было.</p>
      <LibraryItemForm
        ref="formRef"
        :form="form"
        :agents="agentsStore.agents"
        :is-edit="!!editItem"
        :existing-main-id="existingMainId"
        :allowed-types="availableTypeValues"
      />
      <AvailabilityField
        v-if="form.type !== 'plan-template' && !ownProjectOnly" v-model="availability" class="availability" own-folder :within="scope === 'project' ? projectId : undefined"
        hint="Группа и все её проекты вместе — это вся группа: новые проекты группы получат элемент сами. Если проект не отмечен, он не получит."
      />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useLibraryStore } from '../stores/library'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { AvailabilityField, useProjectsStore, type Availability } from '@features/projects'
import type { LibraryItem, LibraryItemType, LibraryScope } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import LibraryItemForm from './LibraryItemForm.vue'

const props = defineProps<{ scope: LibraryScope; projectId?: string; allowedTypes?: LibraryItemType[] }>()
const scope = computed(() => props.scope)

const store = useLibraryStore()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()
const project = computed(() => props.projectId ? projectsStore.projects.find(p => p.id === props.projectId) ?? null : null)

// An item added inside a single project belongs to it alone: there is nothing to choose.
// Opened from a project, an item that comes from its group is changed for this project only.
const editingShared = computed(() => scope.value === 'project' && !!props.projectId && editItem.value?.origin === 'group')
const ownProjectOnly = computed(() => scope.value === 'project' && project.value?.kind === 'project')
const availableTypeValues = computed<LibraryItemType[]>(() => props.allowedTypes ?? (scope.value === 'global' ? ['skill'] : ['skill', 'command', 'main']))
const filterType = ref<LibraryItemType | ''>(availableTypeValues.value.length === 1 ? availableTypeValues.value[0] : '')
const syncing = ref(false)

const typeOptions = [
  { value: '' as const, label: 'Все' },
  { value: 'skill' as LibraryItemType, label: 'Скиллы' },
  { value: 'command' as LibraryItemType, label: 'Команды' },
  { value: 'main' as LibraryItemType, label: 'Главный файл' },
].filter(t => t.value === '' || availableTypeValues.value.includes(t.value))

function typeLabel(t: LibraryItemType) {
  return { skill: 'скилл', command: 'команда', main: 'main', 'plan-template': 'шаблон плана' }[t]
}

// A project lists everything that applies to it; the global list (settings) shows every item.
async function reload() {
  await store.load({
    type: availableTypeValues.value.length === 1 ? availableTypeValues.value[0] : (filterType.value || undefined),
    forProject: scope.value === 'project' ? props.projectId : undefined,
  })
}

function availabilityLabel(item: LibraryItem): string {
  if (item.detached_from) return ''
  if (scope.value === 'project') return item.origin === 'global' ? 'везде' : item.origin === 'group' ? 'через группу' : ''
  if (item.scope === 'global') return 'везде'
  return item.targets.length === 1 ? (projectsStore.byId(item.targets[0])?.name ?? '—') : `выбранным: ${item.targets.length}`
}
function availabilityTitle(item: LibraryItem): string {
  if (item.scope === 'global') return 'Доступно всем проектам'
  return 'Доступно: ' + item.targets.map(id => (projectsStore.byId(id)?.name ?? '—') + (item.own_only?.includes(id) ? ' (только папка группы)' : '')).join(', ')
}

onMounted(() => {
  reload()
  agentsStore.load()
  if (!projectsStore.projects.length) projectsStore.load()
})
watch(() => props.projectId, reload)
watch(availableTypeValues, (types) => {
  filterType.value = types.length === 1 ? types[0] : ''
  reload()
})

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

async function removeItem(item: LibraryItem) {
  // A group's item removed inside a project only leaves that project.
  const shared = scope.value === 'project' && !!props.projectId && item.origin === 'group'
  if (!(await appStore.confirm(shared ? 'Убрать из этого проекта? В группе и в других проектах он останется.' : 'Удалить?'))) return
  try {
    if (shared) { await store.exclude(item.id, props.projectId!); await reload() } else await store.remove(item.id)
    appStore.toast(shared ? 'Убрано из проекта' : 'Удалено', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function reattach(item: LibraryItem) {
  if (!(await appStore.confirm('Вернуть общую версию из группы? Изменения этого проекта будут потеряны.'))) return
  try { await store.reattach(item.id); await reload(); appStore.toast('Возвращена общая версия', 'success') }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
}

const showModal = ref(false)
const editItem = ref<LibraryItem | null>(null)
const defaultForm = () => ({ type: (availableTypeValues.value[0] ?? 'skill') as LibraryItemType, slug: '', title: '', description: '', agent_filter: [] as string[], disableModelInvocation: false, content: '' })
const form = ref(defaultForm())
const availability = ref<Availability>({ everywhere: true, targets: [] })

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `item_${Date.now()}`
}

const formRef = ref<InstanceType<typeof LibraryItemForm> | null>(null)
const existingMainId = ref<string | null>(null)

async function openCreate() {
  editItem.value = null
  existingMainId.value = scope.value === 'global'
    ? null
    : await store.findMainId(scope.value, scope.value === 'project' ? props.projectId : undefined)
  const wanted = (filterType.value as LibraryItemType) || availableTypeValues.value[0] || 'skill'
  const type = wanted === 'main' && existingMainId.value ? 'skill' : wanted
  form.value = {
    ...defaultForm(),
    type,
    title: '',
    content: '',
  }
  availability.value = scope.value === 'project' && props.projectId ? { everywhere: false, targets: [props.projectId] } : { everywhere: true, targets: [] }
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
  availability.value = { everywhere: item.scope === 'global', targets: [...item.targets], ownOnly: [...(item.own_only ?? [])] }
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
    : isMain ? 'main' : form.value.type === 'plan-template' ? slugify(form.value.title || 'default_plan') : slugify(form.value.title)
  const title = isMain ? (form.value.title.trim() || 'Главный файл') : form.value.title.trim()

  const payload = {
    type: form.value.type,
    slug,
    title,
    description: form.value.description.trim(),
    scope: (availability.value.everywhere ? 'global' : 'project') as LibraryScope,
    targets: availability.value.everywhere ? [] : availability.value.targets,
    own_only: availability.value.everywhere ? [] : (availability.value.ownOnly ?? []).filter(id => availability.value.targets.includes(id)),
    frontmatter,
    agent_filter: agentFilter,
    content: form.value.content,
  }

  try {
    if (editItem.value && editingShared.value) {
      const copy = await store.detach(editItem.value.id, props.projectId!)
      await store.update(copy.id, { ...payload, scope: 'project', targets: [props.projectId!], own_only: [] })
      appStore.toast('Сохранено для этого проекта', 'success')
    } else if (editItem.value) {
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
.badge-where { color: var(--blue-hover); }
.availability { margin-top: 12px; }
.shared-note { margin: 0 0 12px; padding: 8px 10px; background: var(--blue-soft); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.45; color: var(--text-muted); }
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
