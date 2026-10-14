<template>
  <div class="settings-tab">
    <form class="settings-form" @submit.prevent="save">
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
        <FormField v-model="form.default_agent_id" label="Агент по умолчанию" type="select">
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

      <section v-if="isProject" class="block">
        <h3>Хостинг кода</h3>
        <p class="git-origin">Фактический origin: <code>{{ actualOrigin || 'не задан' }}</code></p>
        <p v-if="gitError" role="alert" class="git-error">{{ gitError }}</p>
        <FormField v-model="cloneUrl" label="Ссылка для клонирования" placeholder="Из origin папки" hint="Попадает в README группы, чтобы коллеги и агенты знали, откуда брать код." />
        <FormField v-model="hostPath" label="Путь проекта на хостинге" placeholder="team/repo" hint="Пусто — определяется по origin. Нужен для МР и ревью." />
        <FormField v-model="connectionId" label="Подключение к хостингу" type="select" :hint="connections.length ? '' : 'Подключений пока нет: добавьте GitLab в «Настройки → Подключения».'">
          <option value="">— Не выбрано —</option>
          <option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connection.name }}</option>
        </FormField>
      </section>

      <div class="actions">
        <AppButton type="submit" variant="primary" :disabled="saving">{{ saving ? 'Сохранение…' : 'Сохранить' }}</AppButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@core/api'
import type { Project } from '@core/models'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import AppButton from '@shared/ui/AppButton.vue'
import FormField from '@shared/ui/FormField.vue'
import FolderPicker from '@shared/ui/FolderPicker.vue'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'

/** «Настройки» tab of a project or group: its general fields and the code host; branch and merge-request rules live under «Инструкции». */
const props = defineProps<{ project: Project }>()
const appStore = useAppStore()
const agentsStore = useAgentsStore()
const projectsStore = useProjectsStore()

const isProject = computed(() => props.project.kind === 'project')
const form = ref({ name: '', key: '', repo_path: '', group_id: '', description: '', default_agent_id: '', dangerous_commands: '' })
const cloneUrl = ref(''), hostPath = ref(''), connectionId = ref('')
const connections = ref<{ id: string; name: string }[]>([])
const actualOrigin = ref(''), gitError = ref('')
const saving = ref(false)
const suggestedKey = computed(() => form.value.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project')

function fill(p: Project) {
  form.value = {
    name: p.name, key: p.key ?? '', repo_path: p.kind === 'group' ? '' : p.repo_path, group_id: p.group_id ?? '',
    description: p.description, default_agent_id: p.default_agent_id ?? '', dangerous_commands: (p.config.dangerous_commands ?? []).join('\n'),
  }
  cloneUrl.value = p.clone_url ?? ''; hostPath.value = p.host_project_path ?? ''; connectionId.value = p.connection_id ?? ''
}
watch(() => props.project.id, () => {
  fill(props.project)
  void agentsStore.load()
  if (isProject.value) void api.get<{ id: string; name: string }[]>('/integrations/connections').then(value => connections.value = value).catch(() => {})
}, { immediate: true })

watch(() => props.project.id, async id => {
  actualOrigin.value = ''; gitError.value = ''
  if (!isProject.value) return
  try {
    const data = await api.post<{ clone_url: string }>('/projects/git-preview', { repo_path: props.project.repo_path })
    if (props.project.id === id) actualOrigin.value = data.clone_url
  } catch (cause) { if (props.project.id === id) gitError.value = errorText(cause) }
}, { immediate: true })

async function save() {
  const f = form.value
  if (!f.name.trim()) return appStore.toast('Укажите название', 'error')
  if (isProject.value && !f.repo_path.trim()) return appStore.toast('Укажите папку', 'error')
  const data = {
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
  saving.value = true
  try {
    const saved = await projectsStore.update(props.project.id, data)
    appStore.currentProject = projectsStore.byId(saved.id) ?? saved
    appStore.toast('Сохранено', 'success')
  } catch (e) { appStore.toast(errorText(e), 'error') }
  finally { saving.value = false }
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
.actions { display: flex; justify-content: flex-end; position: sticky; bottom: 0; padding: 8px 0; background: var(--bg); }
</style>
