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
        hint="Имя, путь и описание передаются агенту только при явном @упоминании справочника."
      />
    </template>

    <!-- A new project or group asks only for what creating it needs; the rest lives on its «Настройки» tab. -->
    <template v-else>
      <FormField v-model="form.name" label="Название" :placeholder="kind === 'group' ? 'Микрофронты' : 'My Project'" />
      <template v-if="kind === 'project'">
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
        <div v-else class="form-field">
          <label>Путь к репозиторию</label>
          <FolderPicker v-model="form.repo_path" />
        </div>
        <FormField v-model="form.group_id" label="Группа" type="select" :disabled="!!groupId" :hint="groupId ? 'Проект создаётся в этой группе' : ''">
          <option value="">— без группы —</option>
          <option v-for="g in projectsStore.groups" :key="g.id" :value="g.id">🗂 {{ g.name }}</option>
        </FormField>
      </template>
      <div v-else class="projects-note">
        <b>Проекты группы</b>
        Добавить проекты можно сразу после создания: откройте группу, вкладка «Проекты» → «+ Проект» или «добавить существующий».
      </div>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { onServerEvent } from '@core/api/events'
import { api } from '@core/api'
import type { Project, ProjectKind } from '@core/models'
import { useAppStore } from '@core/stores/app'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useProjectsStore } from '../stores/projects'
import DocsSourceFields from './DocsSourceFields.vue'
import type { DocsForm } from '@core/models/integrations'
import { errorText, type ErrorDictionary } from '@shared/utils/errorText'
import { ERRORS as DOCS_ERRORS, FORM as DOCS_FORM } from '../utils/docs-hints'

const CLONE_HINT = 'SSH (git@…) работает с вашим ключом. По HTTPS за SSO вместо пароля нужен токен GitLab.'
const CLONE_ERRORS: ErrorDictionary = [
  [/Authentication failed|could not read Username|terminal prompts disabled|HTTP Basic: Access denied/i, 'Git не смог войти по HTTPS. Используйте SSH-ссылку или HTTPS с токеном GitLab вместо пароля.'],
  [/Permission denied \(publickey|Host key verification failed/i, 'Git не смог войти по SSH. Проверьте, что SSH-ключ добавлен в GitLab и сервер известен (ssh -T git@хост).'],
]

/** Creates a project or group and creates or edits a source; editing a project or group is the «Настройки» tab. */
const props = defineProps<{ modelValue: boolean; kind: ProjectKind; project?: Project | null; groupId?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; saved: [project: Project] }>()
const appStore = useAppStore()
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
  return editing.value ? `Настройки: @${props.project!.key}`
    : props.kind === 'group' ? 'Новая группа' : `Новый ${noun}`
})

const blank = () => ({ name: '', key: '', repo_path: '', group_id: '', description: '', default_agent_id: '' })
const form = ref(blank())
const cloneUrl = ref(''), hostPath = ref('')
let previewSequence = 0
watch(() => form.value.repo_path, async folder => {
 const sequence = ++previewSequence
 if (!props.modelValue || props.kind !== 'project' || creationMode.value !== 'folder' || !folder) return
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

const suggestedCloneFolder = computed(() => cloneUrl.value.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || 'repository')

watch(() => props.modelValue, open => {
  if (!open) { if (cloning.value) void cancelClone(); return }
  creationMode.value = 'folder'; parentFolder.value = localStorage.getItem('plangent:last-clone-parent') || projectsStore.members(props.groupId || '')[0]?.repo_path.replace(/[\\/][^\\/]+$/, '') || ''; cloneFolder.value = ''; cloneOutput.value = ''; cloneError.value = ''; reuseExisting.value = false
  const p = props.project
  cloneUrl.value = ''; hostPath.value = ''
  sourceType.value = p?.source_type || 'folder'; docsValid.value = true
  docsForm.value = { connection_id: p?.connection_id || '', docs_config: JSON.parse(JSON.stringify(p?.docs_config || {})), docs_selection: JSON.parse(JSON.stringify(p?.docs_selection || [])) }
  form.value = p ? {
    name: p.name, key: p.key ?? '', repo_path: p.repo_path,
    group_id: p.group_id ?? '', description: p.description, default_agent_id: p.default_agent_id ?? '',
  } : { ...blank(), group_id: props.groupId ?? '' }
}, { immediate: true })

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
  const config = { ...props.project?.config }
  const data = {
    kind,
    ...(isClone ? { creation_mode: 'clone' as const, operationId: operationId.value = crypto.randomUUID(), reuse_existing: useExisting === true } : {}),
    ...(kind === 'project' ? { clone_url: cloneUrl.value, host_project_path: hostPath.value } : {}),
    // A source shows only its key, so the key doubles as its name.
    name: kind === 'source' ? f.key.trim() : f.name.trim(),
    ...(kind === 'group' ? {} : { key: f.key.trim() || null, repo_path: f.repo_path.trim() }),
    ...(kind === 'project' ? { group_id: f.group_id || null } : {}),
    ...(kind === 'source' ? { source_type: sourceType.value as 'folder' | 'docs', ...(sourceType.value === 'docs' ? docsForm.value : {}) } : {}),
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
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
.projects-note { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--bg3); border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.45; color: var(--text-muted); }
.projects-note b { color: var(--text); font-size: 12.5px; }
</style>
