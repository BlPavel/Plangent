<template>
  <div class="view-content">
    <div class="view-header">
      <h2>Агенты</h2>
      <button class="btn btn-primary" @click="openCreate">+ Добавить агента</button>
    </div>

    <div class="agent-list">
      <div v-if="!agentsStore.agents.length" class="empty-state">
        Нет агентов. Добавьте первого.
      </div>
      <div v-for="a in agentsStore.agents" :key="a.id" class="agent-card">
        <div class="agent-top">
          <div>
            <span class="agent-name">{{ a.name }}</span>
            <code class="agent-cmd">{{ a.command }} {{ a.args.join(' ') }}</code>
          </div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" @click="openEdit(a)">Изменить</button>
            <button class="btn btn-danger btn-sm" @click="remove(a.id)">Удалить</button>
          </div>
        </div>
        <div class="agent-meta">
          <span v-if="Object.keys(a.env).length">
            Env: {{ Object.keys(a.env).join(', ') }}
          </span>
          <span v-if="a.skills_dir">Скиллы → {{ a.skills_dir }}/{{ a.skills_filename }}</span>
          <span v-else-if="a.skills_filename">Скиллы → {{ a.skills_filename }}</span>
        </div>
      </div>
    </div>

    <!-- Create/Edit modal -->
    <AppModal
      v-model="showModal"
      :title="editAgent ? 'Изменить агента' : 'Добавить агента'"
      confirm-label="Сохранить"
      @confirm="save"
    >
      <FormField v-model="form.name" label="Название" placeholder="Claude Code" />
      <FormField
        v-model="form.command"
        label="Команда (исполняемый файл)"
        placeholder="claude"
        hint="Имя команды или полный путь: /usr/local/bin/claude"
      />
      <FormField
        v-model="form.args"
        label="Аргументы (через пробел)"
        placeholder="--dangerously-skip-permissions"
        hint="Будут добавлены к команде при каждом запуске"
      />
      <FormField
        v-model="form.env"
        label="Переменные окружения (JSON)"
        type="textarea"
        :rows="3"
        placeholder='{"HTTPS_PROXY": "http://proxy:8080", "OPENAI_API_KEY": "sk-..."}'
        hint="Все переменные, включая прокси и ключи API"
      />
      <FormField
        v-model="form.skills_dir"
        label="Папка для скиллов (относительно проекта)"
        placeholder=".claude/commands"
        hint="Оставь пустым — скиллы положить в корень проекта"
      />
      <FormField
        v-model="form.skills_filename"
        label="Имя файла скиллов"
        placeholder="plangent.md"
        hint="Файл будет создан перед запуском и удалён после"
      />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAgentsStore } from '../stores/agents'
import { useAppStore } from '@core/stores/app'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import type { Agent } from '@core/models'

const agentsStore = useAgentsStore()
const app = useAppStore()

const showModal = ref(false)
const editAgent = ref<Agent | null>(null)

const defaultForm = () => ({
  name: '',
  command: '',
  args: '',
  env: '{}',
  skills_dir: '',
  skills_filename: 'plangent.md',
})
const form = ref(defaultForm())

onMounted(() => agentsStore.load())

function openCreate() {
  editAgent.value = null
  form.value = defaultForm()
  showModal.value = true
}

function openEdit(a: Agent) {
  editAgent.value = a
  form.value = {
    name: a.name,
    command: a.command,
    args: a.args.join(' '),
    env: JSON.stringify(a.env, null, 2),
    skills_dir: a.skills_dir,
    skills_filename: a.skills_filename,
  }
  showModal.value = true
}

async function save() {
  let envParsed: Record<string, string> = {}
  try {
    envParsed = JSON.parse(form.value.env || '{}')
  } catch {
    app.toast('Невалидный JSON в env', 'error')
    return
  }

  const data = {
    name: form.value.name.trim(),
    command: form.value.command.trim(),
    args: form.value.args.trim() ? form.value.args.trim().split(/\s+/) : [],
    env: envParsed,
    skills_dir: form.value.skills_dir.trim(),
    skills_filename: form.value.skills_filename.trim(),
  }

  try {
    if (editAgent.value) {
      await agentsStore.update(editAgent.value.id, data)
      app.toast('Агент обновлён', 'success')
    } else {
      await agentsStore.create(data)
      app.toast('Агент добавлен', 'success')
    }
    showModal.value = false
  } catch (e: unknown) {
    app.toast(String(e), 'error')
  }
}

async function remove(id: string) {
  if (!confirm('Удалить агента?')) return
  try {
    await agentsStore.remove(id)
    app.toast('Удалён')
  } catch (e: unknown) {
    app.toast(String(e), 'error')
  }
}
</script>

<style scoped>
.view-content { display: flex; flex-direction: column; gap: 16px; padding: 24px; overflow-y: auto; height: 100%; }
.view-header { display: flex; align-items: center; justify-content: space-between; }
.view-header h2 { font-size: 18px; }
.agent-list { display: flex; flex-direction: column; gap: 8px; }
.agent-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.agent-name { font-weight: 600; display: block; margin-bottom: 2px; }
.agent-cmd { font-size: 12px; color: var(--text-muted); display: block; }
.agent-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
</style>
