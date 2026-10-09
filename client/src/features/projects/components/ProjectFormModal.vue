<template>
  <AppModal :model-value="modelValue" :title="title" :size="kind === 'source' && sourceType === 'docs' ? 'large' : 'default'" :confirm-label="editing ? 'Сохранить' : kind === 'project' && creationMode === 'clone' ? (cloning ? 'Клонирование…' : 'Клонировать и создать') : 'Создать'" @update:model-value="$emit('update:modelValue', $event)" @confirm="save">
    <!-- A source is known only by its key: that is what @ shows. -->
    <template v-if="kind === 'source'">
      <FormField v-model="form.key" label="Имя (для @)" placeholder="ui-kit" hint="Латиница, цифры, «-», «.» и «_». В чате — @ui-kit." />
      <FormField v-model="sourceType" label="Тип справочника" type="select" :disabled="editing" :hint="editing ? 'Тип справочника после создания не меняется.' : DOCS_FORM.type"><option value="folder">Папка</option><option value="docs">Документация</option></FormField>
      <DocsSourceFields v-if="sourceType === 'docs'" v-model="docsForm" @valid="docsValid = $event" />
      <div v-else class="form-field">
        <label>Папка</label>
        <FolderPicker v-model="form.repo_path" />
      </div>
      <FormField
        v-model="form.description" label="Описание для агента" type="textarea" :rows="2"
        placeholder="UI-кит компании: компоненты, токены, примеры в /stories"
        hint="Агент видит только имя, путь и это описание — сам справочник читает, лишь когда нужно."
      />
      <AvailabilityField v-model="availability" hint="Где агент знает о справочнике без упоминания. Через @ его можно указать где угодно." />
    </template>

    <template v-else>
      <FormField v-model="form.name" label="Название" :placeholder="kind === 'group' ? 'Микрофронты' : 'My Project'" />
      <template v-if="kind === 'project'">
        <FormField v-model="form.key" label="Ключ (для @)" :placeholder="suggestedKey" hint="Другие проекты и группы ссылаются на этот проект как @ключ. Пусто — из названия." />
        <template v-if="!editing">
          <FormField v-model="creationMode" label="Откуда" type="select"><option value="folder">Папка на диске</option><option value="clone">Клонировать из Git</option></FormField>
          <template v-if="creationMode === 'clone'">
            <FormField v-model="cloneUrl" label="Ссылка для клонирования" placeholder="git@gitlab.example.com:team/repo.git" :hint="CLONE_HINT" :disabled="cloning" />
            <div class="form-field"><label>Родительская папка</label><FolderPicker v-model="parentFolder" /></div>
            <FormField v-model="cloneFolder" label="Имя папки" :placeholder="suggestedCloneFolder" :hint="parentFolder ? 'Проект появится в ' + parentFolder.replace(/[\\/]+$/, '') + '/' + (cloneFolder.trim() || suggestedCloneFolder) : ''" :disabled="cloning" />
            <div v-if="cloning || cloneOutput || reuseExisting" class="clone-box" :class="{ running: cloning }">
              <div class="clone-head">
                <span>{{ cloning ? 'Клонирование…' : reuseExisting ? 'Папка уже содержит этот репозиторий' : cloneError || 'Клонирование не удалось' }}</span>
                <span class="clone-spacer" />
                <AppButton v-if="cloning" type="button" size="xs" variant="danger-ghost" @click="cancelClone">Отменить клонирование</AppButton>
                <AppButton v-if="reuseExisting && !cloning" type="button" size="xs" variant="blue" @click="save(true)">Использовать существующий репозиторий</AppButton>
              </div>
              <pre v-if="cloneOutput">{{ cloneOutput }}</pre>
            </div>
          </template>
        </template>
        <div v-if="editing || creationMode === 'folder'" class="form-field">
          <label>Путь к репозиторию</label>
          <FolderPicker v-model="form.repo_path" />
        </div>
        <FormField v-model="form.group_id" label="Группа" type="select" :disabled="!!groupId" :hint="groupId ? 'Проект создаётся в этой группе' : ''">
          <option value="">— без группы —</option>
          <option v-for="g in projectsStore.groups" :key="g.id" :value="g.id">🗂 {{ g.name }}</option>
        </FormField>
      </template>
      <div v-if="kind === 'group'" class="projects-note">
        <b>Проекты группы</b>
        <template v-if="editing">
          Добавляются, настраиваются и удаляются на вкладке «Проекты» этой группы.
          <button type="button" class="note-link" @click="manageProjects">Открыть вкладку</button>
        </template>
        <template v-else>Добавить проекты можно сразу после создания: откройте группу, вкладка «Проекты» → «+ Проект» или «добавить существующий».</template>
      </div>
      <fieldset v-if="kind === 'project'" class="git-box">
        <legend>Git и хостинг кода</legend>
        <p v-if="editing" class="git-origin">Фактический origin: <code>{{ actualOrigin || 'не задан' }}</code></p>
        <p v-if="gitError" role="alert" class="git-error">{{ gitError }}</p>
        <FormField v-if="editing || creationMode === 'folder'" v-model="cloneUrl" label="Ссылка для клонирования" placeholder="Из origin папки" hint="Попадает в README группы, чтобы коллеги и агенты знали, откуда брать код." />
        <FormField v-model="hostPath" label="Путь проекта на хостинге" placeholder="team/repo" hint="Пусто — определяется по origin. Нужен для МР и ревью." />
        <FormField v-model="connectionId" label="Подключение к хостингу" type="select" :hint="connections.length ? '' : 'Подключений пока нет: добавьте GitLab в «Настройки → Подключения».'"><option v-if="!editing" value="auto">Автоматически по origin</option><option value="">— Не выбрано —</option><option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connection.name }}</option></FormField>
      </fieldset>
      <GitSettingsFields v-if="kind === 'project' || kind === 'group'" v-model="gitSettings" :inherited="inherited" :sources="inheritedSources"  />
      <FormField v-model="form.default_agent_id" label="Агент по умолчанию" type="select">
        <option value="">— выбрать —</option>
        <option v-for="a in agentsStore.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </FormField>
      <FormField
        v-model="form.description" label="Описание для агента" type="textarea" :rows="2"
        :placeholder="kind === 'group' ? 'Микрофронтенды личного кабинета, общий shell' : 'Необязательно'"
        :hint="kind === 'group' ? 'Попадает в README рабочей папки группы.' : 'Показывается агентам соседних проектов рядом с @ключом.'"
      />
      <FormField
        v-if="editing && kind === 'project'"
        v-model="form.dangerous_commands"
        label="Опасные команды"
        type="textarea"
        :rows="3"
        placeholder="git push --force&#10;git reset --hard&#10;rm -rf&#10;git clean -fd"
        hint="По одной команде на строку. Даже в режиме «без вопросов» такая команда переведёт сессию в «ждёт вас»."
      />
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { onServerEvent } from '@core/api/events'
import GitSettingsFields from './GitSettingsFields.vue'
import { api } from '@core/api'
import type { ProjectGitSettings } from '@core/models'
import type { Project, ProjectKind } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useProjectsStore } from '../stores/projects'
import DocsSourceFields from './DocsSourceFields.vue'
import type { DocsForm } from '@core/models/integrations'
import { errorText, type ErrorDictionary } from '@shared/utils/errorText'
import { ERRORS as DOCS_ERRORS, FORM as DOCS_FORM } from '../utils/docs-hints'
import AvailabilityField, { type Availability } from './AvailabilityField.vue'

const CLONE_HINT = 'SSH (git@…) работает с вашим ключом. По HTTPS за SSO вместо пароля нужен токен GitLab.'
const CLONE_ERRORS: ErrorDictionary = [
  [/Authentication failed|could not read Username|terminal prompts disabled|HTTP Basic: Access denied/i, 'Git не смог войти по HTTPS. Используйте SSH-ссылку или HTTPS с токеном GitLab вместо пароля.'],
  [/Permission denied \(publickey|Host key verification failed/i, 'Git не смог войти по SSH. Проверьте, что SSH-ключ добавлен в GitLab и сервер известен (ssh -T git@хост).'],
]

const props = defineProps<{ modelValue: boolean; kind: ProjectKind; project?: Project | null; groupId?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; saved: [project: Project]; 'manage-projects': [] }>()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()

const creationMode = ref('folder'), parentFolder = ref(''), cloneFolder = ref(''), cloneOutput = ref(''), cloneError = ref(''), cloning = ref(false), reuseExisting = ref(false), operationId = ref('')
const unsubscribe = onServerEvent<{ type: string; operationId?: string; output?: string }>(event => {
 if (event.type === 'project:clone-progress' && event.operationId === operationId.value && event.output) cloneOutput.value = (cloneOutput.value + event.output).slice(-100000)
})
onScopeDispose(unsubscribe)
async function cancelClone() {
 if (!operationId.value) return
 try { await api.post('/projects/clone-cancel', { operationId: operationId.value }) } catch (error) { if (cloning.value && props.modelValue) appStore.toast(errorText(error), 'error') }
}
const editing = computed(() => !!props.project)
const title = computed(() => {
  const noun = { project: 'проект', group: 'группа', source: 'справочник' }[props.kind]
  return editing.value ? `Настройки: ${props.project!.kind === 'source' ? '@' + props.project!.key : props.project!.name}`
    : props.kind === 'group' ? 'Новая группа' : `Новый ${noun}`
})

const blank = () => ({ name: '', key: '', repo_path: '', group_id: '', description: '', default_agent_id: '', dangerous_commands: '' })
const form = ref(blank())
const gitSettings = ref<ProjectGitSettings>({})
const cloneUrl = ref(''), hostPath = ref(''), connectionId = ref('')
const connections = ref<{ id: string; name: string }[]>([])
const inherited = ref<ProjectGitSettings>({}), inheritedSources = ref<Record<string, string>>({})
const actualOrigin = ref(''), gitError = ref('')
let settingsGeneration = 0
watch(() => [props.modelValue, form.value.group_id, props.kind], async () => {
 const mine = ++settingsGeneration
 if (!props.modelValue || props.kind === 'source') return
 const group = props.kind === 'project' ? form.value.group_id : ''
 try {
  const data = await api.get<{ values: ProjectGitSettings; sources: Record<string, string> }>(group ? '/projects/' + encodeURIComponent(group) + '/git-settings' : '/projects/git-defaults')
  if (mine !== settingsGeneration) return
  inherited.value = data.values
  inheritedSources.value = Object.fromEntries(Object.entries(data.sources).map(([key, source]) => [key, group && source !== 'default' ? 'group' : 'default']))
 } catch (cause) { if (mine === settingsGeneration) gitError.value = errorText(cause) }
}, { immediate: true })
watch(() => [props.modelValue, props.project?.id], async () => {
 actualOrigin.value = ''; gitError.value = ''
 const p = props.project
 if (!props.modelValue || props.kind !== 'project' || !p) return
 try {
  const data = await api.post<{ clone_url: string }>('/projects/git-preview', { repo_path: p.repo_path })
  if (props.modelValue && props.project?.id === p.id) actualOrigin.value = data.clone_url
 } catch (cause) { if (props.modelValue && props.project?.id === p.id) gitError.value = errorText(cause) }
}, { immediate: true })
let previewSequence = 0
watch(() => form.value.repo_path, async folder => {
 const sequence = ++previewSequence
 if (!props.modelValue || props.kind !== 'project' || props.project || creationMode.value !== 'folder' || !folder) return
 const oldUrl = cloneUrl.value, oldHost = hostPath.value
 try {
  const metadata = await api.post<{ clone_url: string; host_project_path: string }>('/projects/git-preview', { repo_path: folder })
  if (sequence !== previewSequence || !props.modelValue) return
  if (cloneUrl.value === oldUrl) cloneUrl.value = metadata.clone_url
  if (hostPath.value === oldHost) hostPath.value = metadata.host_project_path
 } catch { /* Folder is validated at creation. */ }
})
const sourceType = ref('folder'), docsValid = ref(true)
const docsForm = ref<DocsForm>({ connection_id: '', docs_config: {}, docs_selection: [] })
const availability = ref<Availability>({ everywhere: false, targets: [] })

const suggestedKey = computed(() => form.value.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project')

watch(() => props.modelValue, open => {
  if (!open) { if (cloning.value) void cancelClone(); return }
  void agentsStore.load()
  creationMode.value = 'folder'; parentFolder.value = localStorage.getItem('plangent:last-clone-parent') || projectsStore.members(props.groupId || '')[0]?.repo_path.replace(/[\\/][^\\/]+$/, '') || ''; cloneFolder.value = ''; cloneOutput.value = ''; cloneError.value = ''; reuseExisting.value = false
  const p = props.project
  gitSettings.value = { ...p?.git_settings }
  cloneUrl.value = p?.clone_url ?? ''; hostPath.value = p?.host_project_path ?? ''; connectionId.value = p ? p.connection_id ?? '' : 'auto'
  void api.get<{ id: string; name: string }[]>('/integrations/connections').then(value => connections.value = value).catch(() => {})
  sourceType.value = p?.source_type || 'folder'; docsValid.value = true
  docsForm.value = { connection_id: p?.connection_id || '', docs_config: JSON.parse(JSON.stringify(p?.docs_config || {})), docs_selection: JSON.parse(JSON.stringify(p?.docs_selection || [])) }
  form.value = p ? {
    name: p.name, key: p.key ?? '', repo_path: p.kind === 'group' ? '' : p.repo_path, group_id: p.group_id ?? '',
    description: p.description, default_agent_id: p.default_agent_id ?? '', dangerous_commands: (p.config.dangerous_commands ?? []).join('\n'),
  } : { ...blank(), group_id: props.groupId ?? '' }
  availability.value = { everywhere: !!p?.config.available_everywhere, targets: [...(p?.targets ?? (props.groupId ? [props.groupId] : []))] }
}, { immediate: true })

function manageProjects() {
  emit('update:modelValue', false)
  emit('manage-projects')
}

const suggestedCloneFolder = computed(() => cloneUrl.value.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || 'repository')
async function save(useExisting: unknown = false) {
  if (cloning.value) return
  const f = form.value
  const isClone = !editing.value && props.kind === 'project' && creationMode.value === 'clone'
  if (isClone) {
    const name = cloneFolder.value.trim() || suggestedCloneFolder.value
    if (!parentFolder.value || !cloneUrl.value || !name || /[\\/:]/.test(name) || name === '.' || name === '..') return appStore.toast('Укажите ссылку, родительскую папку и имя папки', 'error')
    localStorage.setItem('plangent:last-clone-parent', parentFolder.value)
    f.repo_path = parentFolder.value.replace(/[\\/]+$/, '') + '/' + name
  }
  const kind = props.kind
  if (kind === 'source' ? !f.key.trim() : !f.name.trim()) return appStore.toast(kind === 'source' ? 'Укажите имя' : 'Укажите название', 'error')
  if (kind === 'source' && sourceType.value === 'docs') {
    if (!docsForm.value.connection_id) return appStore.toast('Выберите подключение', 'error')
    if (!Object.keys(docsForm.value.docs_config).length) return appStore.toast(DOCS_FORM.noConfig, 'error')
    if (!docsValid.value) return appStore.toast(DOCS_FORM.jsonInvalid, 'error')
  }
  if (kind !== 'group' && !(kind === 'source' && sourceType.value === 'docs') && !f.repo_path.trim()) return appStore.toast('Укажите папку', 'error')
  const config = {
    ...props.project?.config,
    ...(kind === 'source' ? { available_everywhere: availability.value.everywhere } : {}),
    ...(kind === 'project' && editing.value ? { dangerous_commands: f.dangerous_commands.split('\n').map(s => s.trim()).filter(Boolean) } : {}),
  }
  const data = {
    kind,
    ...(isClone ? { creation_mode: 'clone' as const, operationId: operationId.value = crypto.randomUUID(), reuse_existing: useExisting === true } : {}),
    ...(kind === 'project' || kind === 'group' ? { git_settings: gitSettings.value } : {}),
    ...(kind === 'project' ? { clone_url: cloneUrl.value, host_project_path: hostPath.value, ...(connectionId.value === 'auto' ? {} : { connection_id: connectionId.value || null }) } : {}),
    // A source shows only its key, so the key doubles as its name.
    name: kind === 'source' ? f.key.trim() : f.name.trim(),
    ...(kind === 'group' ? {} : { key: f.key.trim() || null, repo_path: f.repo_path.trim() }),
    ...(kind === 'project' ? { group_id: f.group_id || null } : {}),
    ...(kind === 'source' ? { targets: availability.value.targets, source_type: sourceType.value as 'folder' | 'docs', ...(sourceType.value === 'docs' ? docsForm.value : {}) } : {}),
    description: f.description.trim(),
    default_agent_id: f.default_agent_id || null,
    config,
  }
  try {
    cloning.value = isClone; cloneOutput.value = ''; cloneError.value = ''; reuseExisting.value = false
    const saved = props.project ? await projectsStore.update(props.project.id, data) : await projectsStore.create(data)
    appStore.toast(editing.value ? 'Сохранено' : 'Создано', 'success')
    emit('update:modelValue', false)
    emit('saved', projectsStore.byId(saved.id) ?? saved)
  } catch (e: unknown) {
    reuseExisting.value = (e as { code?: string }).code === 'reuse_existing'
    const output = (e as { output?: string }).output ?? ''
    cloneOutput.value += output
    // Git explains an auth failure only in its output, not in the error message.
    const message = errorText(isClone && !reuseExisting.value ? new Error(errorText(e) + '\n' + output) : e, kind === 'source' && sourceType.value === 'docs' ? DOCS_ERRORS : isClone ? CLONE_ERRORS : [])
    cloneError.value = isClone ? message.split('\n')[0] : ''
    appStore.toast(cloneError.value || message, 'error')
  } finally { cloning.value = false }
}
</script>

<style scoped>
.clone-box { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; font-size: 12px; border: 1px solid var(--danger-soft); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger-hover); }
.clone-box.running { border-color: var(--border); background: var(--bg3); color: var(--text-muted); }
.clone-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.clone-spacer { flex: 1; }
pre { max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11.5px; color: var(--text-muted); }
.git-box { display: flex; flex-direction: column; gap: 12px; padding: 10px 12px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.git-box legend { padding: 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.git-origin { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
.git-error { font-size: 12px; color: var(--danger-hover); }
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
.projects-note { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--bg3); border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.45; color: var(--text-muted); }
.projects-note b { color: var(--text); font-size: 12.5px; }
.note-link { align-self: flex-start; padding: 0; background: none; border: none; color: var(--blue-hover); font: inherit; cursor: pointer; }
.note-link:hover { text-decoration: underline; }
</style>
