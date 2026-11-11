<template>
  <form class="settings-form" @submit.prevent>
      <section v-if="section === 'general'" class="block">
        <FormField v-model="form.name" label="Название" />
        <template v-if="isProject">
          <FormField v-model="form.key" label="Ключ (для @)" :placeholder="suggestedKey" hint="Другие проекты и группы ссылаются на этот проект как @ключ. Пусто — из названия." />
          <div class="form-field">
            <label>Путь к репозиторию</label>
            <FolderPicker v-model="form.repo_path" />
          </div>
          <FormField v-model="form.group_id" label="Группа" type="select">
            <option value="">— без группы —</option>
            <option v-for="g in projectsStore.groups" :key="g.id" :value="g.id">🗂️ {{ g.name }}</option>
          </FormField>
        </template>
        <FormField v-model="form.default_agent_id" label="Агент по умолчанию" type="select" :hint="isProject ? 'Для чатов и работ проекта.' : 'Для чатов группы и её проектов, у которых нет своего.'">
          <option value="">{{ groupAgent ? `Как в группе — ${groupAgent}` : '— выбрать —' }}</option>
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

      <section v-if="section === 'hosting' && isProject" class="block">
        <p class="git-origin">Фактический origin: <code>{{ actualOrigin || 'не задан' }}</code></p>
        <p v-if="gitError" role="alert" class="git-error">{{ gitError }}</p>
        <FormField v-model="cloneUrl" label="Ссылка для клонирования" placeholder="Из origin папки" hint="Попадает в README группы, чтобы коллеги и агенты знали, откуда брать код. Примеры: https://gitlab.example.com/team/repo.git, git@github.com:org/repo.git" />
        <FormField v-model="hostPath" label="Путь проекта на хостинге" placeholder="team/repo" hint="Пусто — определяется по origin. Нужен для МР и ревью. Это часть адреса репозитория после домена, без .git: для https://gitlab.example.com/team/repo.git — team/repo, для проекта во вложенной группе — team/sub/repo, для GitHub — org/repo." />
        <FormField v-model="connectionId" label="Подключение к хостингу" type="select" :hint="connections.length ? 'Подключение с токеном к тому же серверу, что и репозиторий: например, GitLab https://gitlab.example.com или GitHub https://api.github.com.' : 'Подключений пока нет: добавьте GitLab в «Настройки → Подключения».'">
          <option value="">— Не выбрано —</option>
          <option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connectionLabel(connection) }}</option>
        </FormField>
      </section>

      <div class="actions"><SaveStatus :state="saveState" /></div>
  </form>
</template>

<script setup lang="ts">
import { settingsEndpoints } from '@features/settings'
import { projectsEndpoints } from '../api'

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Project } from '@contracts'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import SaveStatus, { type SaveState } from '@shared/ui/SaveStatus.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from './FolderPicker.vue'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'

/** A page of the project or group settings: its general fields or, for a project, the code host. Saves as you type. */
const props = defineProps<{ project: Project; section: 'general' | 'hosting' }>()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()

const isProject = computed(() => props.project.kind === 'project')
// A project without its own default agent works with its group's.
const groupAgent = computed(() => {
  const id = projectsStore.byId(props.project.group_id)?.default_agent_id
  return id ? agentsStore.agents.find(a => a.id === id)?.name ?? null : null
})
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
    void settingsEndpoints.getIntegrationsConnections({ params: {  } }).then(value => connections.value = value).catch(() => {})
    void settingsEndpoints.getIntegrationsOrganizations({ params: {  } }).then(value => organizations.value = value).catch(() => {})
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
    const data = await projectsEndpoints.postProjectsGitPreview({ params: {  }, body: { repo_path: props.project.repo_path } })
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
.settings-form { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.block { display: flex; flex-direction: column; gap: 12px; }
.form-field { display: flex; flex-direction: column; gap: 4px; }
label { font-size: var(--fs-sm); color: var(--text-muted); }
.git-origin { font-size: var(--fs-sm); color: var(--text-muted); overflow-wrap: anywhere; }
.git-error { font-size: var(--fs-sm); color: var(--danger-hover); }
.actions { display: flex; justify-content: flex-end; min-height: 18px; }
</style>
