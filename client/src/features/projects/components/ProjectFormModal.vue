<template>
  <AppModal :model-value="modelValue" :title="title" :size="kind === 'source' && sourceType === 'docs' ? 'large' : 'default'" :confirm-label="editing ? 'Сохранить' : 'Создать'" @update:model-value="$emit('update:modelValue', $event)" @confirm="save">
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
        <div class="form-field">
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
import { computed, ref, watch } from 'vue'
import type { Project, ProjectKind } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import { useProjectsStore } from '../stores/projects'
import DocsSourceFields from './DocsSourceFields.vue'
import type { DocsForm } from '@core/models/integrations'
import { errorText } from '@shared/utils/errorText'
import { ERRORS as DOCS_ERRORS, FORM as DOCS_FORM } from '../utils/docs-hints'
import AvailabilityField, { type Availability } from './AvailabilityField.vue'

const props = defineProps<{ modelValue: boolean; kind: ProjectKind; project?: Project | null; groupId?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; saved: [project: Project]; 'manage-projects': [] }>()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()

const editing = computed(() => !!props.project)
const title = computed(() => {
  const noun = { project: 'проект', group: 'группа', source: 'справочник' }[props.kind]
  return editing.value ? `Настройки: ${props.project!.kind === 'source' ? '@' + props.project!.key : props.project!.name}`
    : props.kind === 'group' ? 'Новая группа' : `Новый ${noun}`
})

const blank = () => ({ name: '', key: '', repo_path: '', group_id: '', description: '', default_agent_id: '', dangerous_commands: '' })
const form = ref(blank())
const sourceType = ref('folder'), docsValid = ref(true)
const docsForm = ref<DocsForm>({ connection_id: '', docs_config: {}, docs_selection: [] })
const availability = ref<Availability>({ everywhere: false, targets: [] })

const suggestedKey = computed(() => form.value.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project')

watch(() => props.modelValue, open => {
  if (!open) return
  void agentsStore.load()
  const p = props.project
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

async function save() {
  const f = form.value
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
    const saved = props.project ? await projectsStore.update(props.project.id, data) : await projectsStore.create(data)
    appStore.toast(editing.value ? 'Сохранено' : 'Создано', 'success')
    emit('update:modelValue', false)
    emit('saved', projectsStore.byId(saved.id) ?? saved)
  } catch (e: unknown) { appStore.toast(errorText(e, kind === 'source' && sourceType.value === 'docs' ? DOCS_ERRORS : []), 'error') }
}
</script>

<style scoped>
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
.projects-note { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--bg3); border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.45; color: var(--text-muted); }
.projects-note b { color: var(--text); font-size: 12.5px; }
.note-link { align-self: flex-start; padding: 0; background: none; border: none; color: var(--blue-hover); font: inherit; cursor: pointer; }
.note-link:hover { text-decoration: underline; }
</style>
