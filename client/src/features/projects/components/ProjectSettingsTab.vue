<template>
  <div class="settings-tab">
    <form class="settings-form" @submit.prevent>
      <section class="block">
        <h3>Основное</h3>
        <FormField v-model="form.name" label="Название" />
        <template v-if="isProject">
          <FormField v-model="form.key" label="Ключ (для @)" :placeholder="suggestedKey" hint="Другие проекты и группы ссылаются на этот проект как @ключ. Пусто — из названия." />
          <div class="form-field">
            <label>Путь к репозиторию</label>
            <FolderPicker v-model="form.repo_path" />
          </div>
          <FormField v-model="form.group_id" label="Группа" type="select">
            <option value="">— без группы —</option>
            <option v-for="g in projectsStore.groups" :key="g.id" :value="g.id">🗂 {{ g.name }}</option>
          </FormField>
        </template>
        <FormField v-model="form.default_agent_id" label="Агент по умолчанию" type="select" hint="Для чатов проекта.">
          <option value="">— выбрать —</option>
          <option v-for="a in agentsStore.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </FormField>
        <FormField
          v-model="form.description" label="Описание для агента" type="textarea" :rows="2"
          :placeholder="isProject ? 'Необязательно' : 'Микрофронтенды личного кабинета, общий shell'"
          :hint="isProject ? 'Показывается агентам соседних проектов рядом с @ключом.' : 'Попадает в README рабочей папки группы.'"
        />
        <FormField
          v-if="isProject"
          v-model="form.dangerous_commands"
          label="Опасные команды"
          type="textarea"
          :rows="3"
          placeholder="git push --force&#10;git reset --hard&#10;rm -rf&#10;git clean -fd"
          hint="По одной команде на строку. Даже в режиме «без вопросов» такая команда переведёт сессию в «ждёт вас»."
        />
      </section>

      <section class="block">
        <h3>Агент для коммитов и МР</h3>
        <!-- Saves by itself, like the other git settings: not part of this form's «Сохранить». -->
        <ProjectGitPanel :project-id="project.id" section="agent" />
      </section>

      <section v-if="isProject" class="block">
        <h3>Рабочее место для задач и поручений</h3>
        <!-- Saves by itself, like the other git settings. -->
        <ProjectGitPanel :project-id="project.id" section="workspace" />
      </section>

      <section v-if="isProject" class="block">
        <h3>Хостинг кода</h3>
        <p class="git-origin">Фактический origin: <code>{{ actualOrigin || 'не задан' }}</code></p>
        <p v-if="gitError" role="alert" class="git-error">{{ gitError }}</p>
        <FormField v-model="cloneUrl" label="Ссылка для клонирования" placeholder="Из origin папки" hint="Попадает в README группы, чтобы коллеги и агенты знали, откуда брать код." />
        <FormField v-model="hostPath" label="Путь проекта на хостинге" placeholder="team/repo" hint="Пусто — определяется по origin. Нужен для МР и ревью." />
        <FormField v-model="connectionId" label="Подключение к хостингу" type="select" :hint="connections.length ? '' : 'Подключений пока нет: добавьте GitLab в «Настройки → Подключения».'">
          <option value="">— Не выбрано —</option>
          <option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connectionLabel(connection) }}</option>
        </FormField>
      </section>

      <div class="actions"><SaveStatus :state="saveState" /></div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '@core/api'
import type { Project } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'
import ProjectGitPanel from './ProjectGitPanel.vue'

/** «Настройки» tab of a project or group: its general fields and the code host; branch and merge-request rules live under «Инструкции». */
const props = defineProps<{ project: Project }>()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()

const isProject = computed(() => props.project.kind === 'project')
const form = ref({ name: '', key: '', repo_path: '', group_id: '', description: '', default_agent_id: '', dangerous_commands: '' })
const cloneUrl = ref(''), hostPath = ref(''), connectionId = ref('')
const connections = ref<{ id: string; name: string; organization_id: string | null }[]>([]), organizations = ref<{ id: string; name: string }[]>([])
/** «Компания - название»; a connection without a company is just its name. */
const connectionLabel = (c: { name: string; organization_id: string | null }) => {
  const company = organizations.value.find(o => o.id === c.organization_id)?.name
  return company ? company + ' - ' + c.name : c.name
}
const actualOrigin = ref(''), gitError = ref('')
const saveState = ref<SaveState>('idle')
const suggestedKey = computed(() => form.value.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project')

function fill(p: Project) {
  form.value = {
    name: p.name, key: p.key ?? '', repo_path: p.kind === 'group' ? '' : p.repo_path, group_id: p.group_id ?? '',
    description: p.description, default_agent_id: p.default_agent_id ?? '', dangerous_commands: (p.config.dangerous_commands ?? []).join('\n'),
  }
  cloneUrl.value = p.clone_url ?? ''; hostPath.value = p.host_project_path ?? ''; connectionId.value = p.connection_id ?? ''
}
/** The request body for what is in the form now; null while it cannot be saved (no name or folder yet). */
function payload() {
  const f = form.value
  if (!f.name.trim() || isProject.value && !f.repo_path.trim()) return null
  return {
    kind: props.project.kind,
    ...(isProject.value ? {
      clone_url: cloneUrl.value, host_project_path: hostPath.value, connection_id: connectionId.value || null,
      key: f.key.trim() || null, repo_path: f.repo_path.trim(), group_id: f.group_id || null,
    } : {}),
    name: f.name.trim(),
    description: f.description.trim(),
    default_agent_id: f.default_agent_id || null,
    config: {
      ...props.project.config,
      ...(isProject.value ? { dangerous_commands: f.dangerous_commands.split('\n').map(s => s.trim()).filter(Boolean) } : {}),
    },
  }
}
// Typing saves after a pause; a pending save is flushed when another project opens or the tab closes.
let timer: ReturnType<typeof setTimeout> | undefined, pending: (() => Promise<void>) | undefined, lastSaved = ''
function flush() { clearTimeout(timer); const run = pending; pending = undefined; return run?.() }
watch(() => props.project.id, () => {
  void flush()
  fill(props.project)
  lastSaved = JSON.stringify(payload())
  saveState.value = 'idle'
  void agentsStore.load()
  if (isProject.value) {
    void api.get<typeof connections.value>('/integrations/connections').then(value => connections.value = value).catch(() => {})
    void api.get<typeof organizations.value>('/integrations/organizations').then(value => organizations.value = value).catch(() => {})
  }
}, { immediate: true })
watch([form, cloneUrl, hostPath, connectionId], () => {
  const id = props.project.id, data = payload()
  if (!data || JSON.stringify(data) === lastSaved) return
  pending = () => save(id, data)
  clearTimeout(timer)
  saveState.value = 'pending'
  timer = setTimeout(flush, 600)
}, { deep: true })
onBeforeUnmount(() => { void flush() })

watch(() => props.project.id, async id => {
  actualOrigin.value = ''; gitError.value = ''
  if (!isProject.value) return
  try {
    const data = await api.post<{ clone_url: string }>('/projects/git-preview', { repo_path: props.project.repo_path })
    if (props.project.id === id) actualOrigin.value = data.clone_url
  } catch (cause) { if (props.project.id === id) gitError.value = errorText(cause) }
}, { immediate: true })

async function save(id: string, data: NonNullable<ReturnType<typeof payload>>) {
  saveState.value = 'saving'
  try {
    const saved = await projectsStore.update(id, data)
    lastSaved = JSON.stringify(data)
    if (appStore.currentProject?.id === saved.id) appStore.currentProject = projectsStore.byId(saved.id) ?? saved
    saveState.value = 'saved'
  } catch (e) { saveState.value = 'idle'; appStore.toast(errorText(e), 'error') }
}
</script>

<style scoped>
.settings-tab { flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6); }
.settings-form { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.block { display: flex; flex-direction: column; gap: 12px; }
h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: 12px; color: var(--text-muted); }
.git-origin { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
.git-error { font-size: 12px; color: var(--danger-hover); }
.actions { display: flex; justify-content: flex-end; min-height: 18px; }
</style>
