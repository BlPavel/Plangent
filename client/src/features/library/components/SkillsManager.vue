<template>
  <div class="lib">
    <div class="lib-header" :class="{ tabbed: showTabs }">
      <AppTabs v-if="showTabs" bare :model-value="filterType" :items="typeOptions" label="Типы элементов" @update:model-value="filterType = $event as typeof filterType; reload()" />
      <div class="lib-actions">
        <slot name="actions">
          <AppButton v-if="agent" variant="blue" size="sm" @click="agent.open(agentRequest)">▸ Написать с агентом</AppButton>
        </slot>
        <AppButton variant="ghost" size="sm" :disabled="syncing" @click="doSync">
          {{ syncing ? '...' : '↻ Синк' }}
        </AppButton>
        <AppButton variant="primary" size="sm" @click="openCreate">+ Добавить</AppButton>
      </div>
    </div>

    <AppCheckbox v-if="scope === 'project' && project?.kind === 'project'" :model-value="!project.hide_from_git" @update:model-value="toggleGitVisibility">
      <span>
        Включать созданные файлы в git
        <span class="git-hint">
          {{ project.hide_from_git
            ? 'Скрыты через .git/info/exclude (локально, не пушится).'
            : 'Видны в git status.' }}
        </span>
      </span>
    </AppCheckbox>

    <div class="item-list">
      <div v-if="loading" class="muted-msg">Загрузка...</div>
      <div v-else-if="!items.length" class="muted-msg">
        Нет элементов. Нажмите «+ Добавить».
      </div>
      <AppItemCard v-for="item in items" :key="item.id" :highlighted="fresh === item.id">
        <template #lead>
          <AppSwitch :model-value="item.enabled" :title="item.enabled ? 'Включён' : 'Выключен'" :aria-label="item.title" @update:model-value="toggleEnabled(item)" />
        </template>
        <template #title>{{ item.title }}</template>
        <template #subtitle>
          <span class="item-slug">{{ item.slug }}</span>
          <span v-if="item.description" class="item-desc">{{ item.description }}</span>
        </template>
        <template #actions>
          <AppBadge>{{ typeLabel(item.type) }}</AppBadge>
          <AppBadge v-if="availabilityLabel(item)" :title="availabilityTitle(item)">{{ availabilityLabel(item) }}</AppBadge>
          <AppBadge v-if="item.agent_filter.length">{{ item.agent_filter.join(', ') }}</AppBadge>
          <AppButton variant="ghost" size="sm" @click="openEdit(item)">Изменить</AppButton>
          <AppButton variant="danger-ghost" size="sm" icon title="Удалить" @click="removeItem(item)">
            <IconTrash />
          </AppButton>
        </template>
      </AppItemCard>
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
        v-if="form.type !== 'plan-template' && !ownProjectOnly && scope !== 'global'" v-model="availability" class="availability" own-folder :within="scope === 'project' ? projectId : undefined"
        hint="Группа и все её проекты вместе — это вся группа: новые проекты группы получат элемент сами. Если проект не отмечен, он не получит."
      />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import { AppCheckbox, AppItemCard, AppSwitch, AppTabs } from '@shared/ui'
import { libraryEndpoints } from '../api'

import { ref, computed, inject, onMounted, onBeforeUnmount, watch } from 'vue'
import { libraryAgentKey } from '../agent-context'
import { onServerEvent } from '@core/api/events'
import { useLibraryStore } from '../stores/library'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { AvailabilityField, useProjectsStore, type Availability } from '@features/projects'
import type { LibraryItem, LibraryItemType, LibraryScope } from '@contracts'
import { LIBRARY_TYPES, LIBRARY_FORM_TYPES, libraryTypeLabel, librarySection } from '../../../../../common/library-registry'
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
function isSharedInProject(item: LibraryItem): boolean {
  return ownProjectOnly.value && (item.origin === 'group' || !!project.value?.group_id && item.targets.includes(project.value.group_id))
}
const editingShared = computed(() => !!editItem.value && isSharedInProject(editItem.value))
const ownProjectOnly = computed(() => scope.value === 'project' && project.value?.kind === 'project')
const availableTypeValues = computed<LibraryItemType[]>(() => props.allowedTypes ?? librarySection(scope.value, scope.value === 'global' ? 'skills' : 'items')!.types)
const showTabs = computed(() => scope.value !== 'global' && availableTypeValues.value.length > 1)
const filterType = ref<LibraryItemType | ''>(availableTypeValues.value.length === 1 ? availableTypeValues.value[0] : '')
const syncing = ref(false)
const agent = inject(libraryAgentKey, null)
const agentRequest = computed(() => `${scope.value === 'global' ? 'Глобально: нужен' : 'Нужен'} ${SKILL_NOUN[availableTypeValues.value[0]] ?? 'скилл'}: `)
const SKILL_NOUN: Partial<Record<LibraryItemType, string>> = { 'review-skill': 'скилл ревью МР', 'plan-review-skill': 'скилл ревью плана', 'architecture-review-skill': 'скилл ревью архитектуры', 'qa-review-skill': 'скилл ревью QA' }

const typeOptions = computed(() => [
  { value: '' as const, label: 'Все' },
  ...LIBRARY_FORM_TYPES.map(value => ({ value, label: libraryTypeLabel(value, 'list') })),
].filter(t => t.value === '' || availableTypeValues.value.includes(t.value)))

function typeLabel(t: LibraryItemType) {
  return LIBRARY_TYPES[t].title
}

// Each mounted list owns its results: hidden project views can reload independently of settings.
const items = ref<LibraryItem[]>([])
const loading = ref(false)
let loadRevision = 0

// Projects include inherited items; settings list only global items.
async function reload() {
  const revision = ++loadRevision
  loading.value = true
  items.value = []
  try {
    const params = new URLSearchParams()
    const type = availableTypeValues.value.length === 1 ? availableTypeValues.value[0] : filterType.value
    if (type) params.set('type', type)
    if (scope.value === 'global') params.set('scope', 'global')
    else if (props.projectId) params.set('forProject', props.projectId)
    const result = await libraryEndpoints.getLibrary({ params: {  }, query: Object.fromEntries(new URLSearchParams(params)) })
    if (revision === loadRevision) items.value = result.filter(item => availableTypeValues.value.includes(item.type))
  } catch (e) {
    if (revision === loadRevision) appStore.toast(String(e), 'error')
  } finally {
    if (revision === loadRevision) loading.value = false
  }
}

function availabilityLabel(item: LibraryItem): string {
  // Global skills apply everywhere by definition: nothing to say about who gets them.
  if (scope.value === 'global' || item.detached_from) return ''
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
// An applied agent proposal changes the library on the server: show it right away and highlight it for a moment.
const fresh = ref('')
let freshTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(onServerEvent<{ type: string; item?: LibraryItem }>(event => {
  if (event.type !== 'library_changed') return
  void reload()
  fresh.value = event.item?.id ?? ''
  clearTimeout(freshTimer)
  freshTimer = setTimeout(() => { fresh.value = '' }, 4000)
}))
onBeforeUnmount(() => clearTimeout(freshTimer))
watch(() => [props.scope, props.projectId], reload)
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

async function toggleGitVisibility(checked: boolean) {
  if (!project.value) return
  const hide = !checked
  try {
    await projectsStore.update(project.value.id, { hide_from_git: hide })
    await store.syncAll()
    appStore.toast(hide ? 'Файлы скрыты от git' : 'Файлы включены в git', 'success')
  } catch (err: unknown) { appStore.toast(String(err), 'error') }
}

async function toggleEnabled(item: LibraryItem) {
  try {
    const updated = await store.update(item.id, { enabled: !item.enabled })
    const index = items.value.findIndex(i => i.id === item.id)
    if (index !== -1) items.value[index] = updated
  }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function removeItem(item: LibraryItem) {
  // A group's item removed inside a project only leaves that project.
  const shared = isSharedInProject(item)
  const name = `«${item.title}»`
  const question = shared ? `Убрать ${name} из этого проекта? В группе и в других проектах он останется.`
    : scope.value === 'global' ? `Удалить ${name} для всех проектов? Агенты больше не будут получать этот элемент, его файлы уберутся из их папок.`
    : `Удалить ${name}? Его файлы уберутся из папок агентов, где он был доступен.`
  if (!(await appStore.confirm(question, { confirmLabel: shared ? 'Убрать' : 'Удалить', danger: true }))) return
  try {
    if (shared) await store.exclude(item.id, props.projectId!)
    else await store.remove(item.id)
    await reload()
    appStore.toast(shared ? 'Убрано из проекта' : 'Удалено', 'success')
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
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
    : isMain ? 'main' : form.value.type === 'plan-template' ? slugify(form.value.title || 'default_plan') : (form.value.type === 'review-skill' || form.value.type.endsWith('-review-skill')) ? 'review_' + Date.now().toString(36) : slugify(form.value.title)
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
      await store.detach(editItem.value.id, props.projectId!, payload)
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
/* The tabs are bare: the line under the whole bar is drawn here, so the active tab sits on it. */
.lib-header.tabbed { align-items: stretch; border-bottom: 1px solid var(--border); }
.lib-header.tabbed .lib-actions { align-items: center; padding-bottom: var(--sp-1); }
.lib-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.lib-actions { display: flex; gap: 6px; flex-shrink: 0; }

.tab-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  padding: 4px 10px;
  cursor: pointer;
  font-size: var(--fs-sm);
  transition: all var(--motion-instant);
}
.tab-btn.active { background: var(--bg3); color: var(--text); border-color: var(--blue); }

.git-toggle {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: var(--fs-sm); color: var(--text); cursor: pointer;
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 7px 10px;
}
.git-toggle input { margin-top: 2px; }
.git-hint { display: block; font-size: var(--fs-xs); color: var(--text-muted); opacity: 0.75; margin-top: 1px; }

.item-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1; }
.muted-msg { color: var(--text-muted); font-size: var(--fs-md); padding: 8px 0; }

.item-slug { display: block; font-size: var(--fs-xs); font-family: var(--font-mono); }
.item-desc { display: block; font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge-where { color: var(--blue-hover); }
.availability { margin-top: 12px; }
.shared-note { margin: 0 0 12px; padding: 8px 10px; background: var(--blue-soft); border-radius: var(--radius-sm); font-size: var(--fs-sm); line-height: 1.45; color: var(--text-muted); }
.badge { font-size: var(--fs-xs); padding: 2px 6px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-4); color: var(--text-muted); }

/* Toggle */
.toggle { position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer; flex-shrink: 0; }
.toggle input { display: none; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: var(--radius-18); transition: background 0.2s; }
.toggle-slider::before { content: ''; position: absolute; width: 12px; height: 12px; left: 3px; top: 3px; background: white; border-radius: var(--radius-round); transition: transform 0.2s; }
.toggle input:checked + .toggle-slider { background: var(--blue); }
.toggle input:checked + .toggle-slider::before { transform: translateX(14px); }
</style>
