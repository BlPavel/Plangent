<template>
  <div class="settings">
    <div class="settings-header app-drag">
      <h2>Настройки</h2>
    </div>

    <div class="settings-tabs">
      <button class="stab" :class="{ active: tab === 'agents' }" @click="tab = 'agents'">Агенты</button>
      <button class="stab" :class="{ active: tab === 'skills' }" @click="tab = 'skills'">Скиллы</button>
      <button class="stab" :class="{ active: tab === 'plan-template' }" @click="tab = 'plan-template'">Шаблон плана</button>
    </div>

    <!-- Agents -->
    <div v-show="tab === 'agents'" class="tab-body">
      <div class="section-header">
        <span class="section-title">Агенты</span>
        <AppButton variant="primary" size="sm" @click="openCreate">+ Добавить агента</AppButton>
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
              <AppButton variant="ghost" size="sm" @click="openEdit(a)">Изменить</AppButton>
              <AppButton variant="danger-ghost" size="sm" @click="remove(a.id)">
                <IconTrash /> Удалить
              </AppButton>
            </div>
          </div>
          <div class="agent-meta">
            <span v-if="Object.keys(a.env).length">Env: {{ Object.keys(a.env).join(', ') }}</span>
            <span v-if="a.skills_dir">Скиллы → {{ a.skills_dir }}/{{ a.skills_filename }}</span>
            <span v-else-if="a.skills_filename">Скиллы → {{ a.skills_filename }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Skills (global) -->
    <div v-show="tab === 'skills'" class="tab-body">
      <p class="hint">Глобальные скиллы разработчика применяются ко всем агентам во всех проектах. Инструкции для конкретного проекта задаются во вкладке «Инструкции» внутри проекта.</p>
      <SkillsManager scope="global" :allowed-types="['skill']" />
    </div>

    <!-- Plan template (global) -->
    <div v-show="tab === 'plan-template'" class="tab-body">
      <p class="hint">Глобальный шаблон применяется ко всем проектам, если проект не переопределил его в своих инструкциях.</p>
      <PlanTemplateEditor scope="global" />
    </div>

    <!-- Agent create/edit modal -->
    <AppModal
      v-model="showAgentModal"
      :title="editAgent ? 'Изменить агента' : 'Добавить агента'"
      confirm-label="Сохранить"
      @confirm="saveAgent"
    >
      <FormField v-model="agentForm.name" label="Название" placeholder="Claude Code" />
      <FormField v-model="agentForm.command" label="Команда" placeholder="claude" hint="Имя команды или полный путь" />
      <FormField v-model="agentForm.args" label="Аргументы (через пробел)" placeholder="--dangerously-skip-permissions" hint="Добавляются к команде при каждом запуске" />
      <FormField v-model="agentForm.env" label="Переменные окружения (JSON)" type="textarea" :rows="3" placeholder='{"OPENAI_API_KEY": "sk-..."}' hint="Все переменные, включая прокси и ключи API" />
      <FormField v-model="agentForm.skills_dir" label="Папка для скиллов (относительно проекта)" placeholder=".claude/commands" hint="Оставь пустым — скиллы в корень проекта" />
      <FormField v-model="agentForm.skills_filename" label="Имя файла скиллов" placeholder="plangent.md" hint="Файл создаётся перед запуском и удаляется после" />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import type { Agent } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { PlanTemplateEditor, SkillsManager } from '@features/library'

const appStore = useAppStore()
const agentsStore = useAgentsStore()

const tab = ref<'agents' | 'skills' | 'plan-template'>('agents')

// ── Agents ────────────────────────────────────────────────────────────────────

const showAgentModal = ref(false)
const editAgent = ref<Agent | null>(null)

const defaultAgentForm = () => ({
  name: '', command: '', args: '', env: '{}', skills_dir: '', skills_filename: 'plangent.md',
})
const agentForm = ref(defaultAgentForm())

function openCreate() {
  editAgent.value = null
  agentForm.value = defaultAgentForm()
  showAgentModal.value = true
}

function openEdit(a: Agent) {
  editAgent.value = a
  agentForm.value = {
    name: a.name,
    command: a.command,
    args: a.args.join(' '),
    env: JSON.stringify(a.env, null, 2),
    skills_dir: a.skills_dir,
    skills_filename: a.skills_filename,
  }
  showAgentModal.value = true
}

async function saveAgent() {
  let envParsed: Record<string, string> = {}
  try { envParsed = JSON.parse(agentForm.value.env || '{}') } catch {
    appStore.toast('Невалидный JSON в env', 'error'); return
  }
  const data = {
    name: agentForm.value.name.trim(),
    command: agentForm.value.command.trim(),
    args: agentForm.value.args.trim() ? agentForm.value.args.trim().split(/\s+/) : [],
    env: envParsed,
    skills_dir: agentForm.value.skills_dir.trim(),
    skills_filename: agentForm.value.skills_filename.trim(),
  }
  try {
    if (editAgent.value) {
      await agentsStore.update(editAgent.value.id, data)
      appStore.toast('Агент обновлён', 'success')
    } else {
      await agentsStore.create(data)
      appStore.toast('Агент добавлен', 'success')
    }
    showAgentModal.value = false
  } catch (e: unknown) { appStore.toast(String(e), 'error') }
}

async function remove(id: string) {
  if (!(await appStore.confirm('Удалить агента?'))) return
  try { await agentsStore.remove(id); appStore.toast('Удалён') }
  catch (e: unknown) { appStore.toast(String(e), 'error') }
}

onMounted(() => { agentsStore.load() })
</script>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.settings-header {
  padding: calc(var(--titlebar-h) + var(--sp-4)) var(--sp-6) 0;
  flex-shrink: 0;
}
.settings-header h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: var(--sp-4); }

.settings-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--sp-6);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tab-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.stab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  padding: 9px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}
.stab:hover { color: var(--text); }
.stab.active { color: var(--text); border-bottom-color: var(--blue); }
.stab:disabled { opacity: 0.4; cursor: default; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title { font-weight: 600; font-size: 14px; }

.agent-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.agent-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  transition: border-color 0.12s;
}
.agent-card:hover { border-color: var(--border-strong); }
.agent-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.agent-name { font-weight: 600; display: block; margin-bottom: 2px; }
.agent-cmd { font-size: 12px; color: var(--text-muted); display: block; }
.agent-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }

.hint { font-size: 12px; color: var(--text-muted); }
</style>
