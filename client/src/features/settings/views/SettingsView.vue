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
              <AppButton v-if="a.update_command" variant="ghost" size="sm" :disabled="updatingAgentId === a.id" @click="updateAgent(a)">
                {{ updatingAgentId === a.id ? 'Обновление…' : 'Обновить' }}
              </AppButton>
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
      <FormField v-model="agentForm.update_command" label="Команда обновления" placeholder="npm update -g @vendor/agent" hint="Выполняется локально по кнопке «Обновить». Оставьте пустым, если обновление не поддерживается." />
      <FormField v-model="agentForm.args" label="Аргументы (через пробел)" placeholder="--dangerously-skip-permissions --model {model} --effort {reasoning}" hint="Добавляются к команде при каждом запуске. {model} и {reasoning} — точки подстановки для полей ниже" />
      <FormField v-model="agentForm.env" label="Переменные окружения (JSON)" type="textarea" :rows="3" placeholder='{"OPENAI_API_KEY": "sk-..."}' hint="Все переменные, включая прокси и ключи API" />
      <FormField v-model="agentForm.skills_dir" label="Папка для скиллов (относительно проекта)" placeholder=".claude/commands" hint="Оставь пустым — скиллы в корень проекта" />
      <FormField v-model="agentForm.skills_filename" label="Имя файла скиллов" placeholder="plangent.md" hint="Файл создаётся перед запуском и удаляется после" />

      <template v-if="hasModelPlaceholder">
        <TagListEditor
          v-model="agentForm.model_options"
          label="Доступные модели"
          placeholder="opus"
          hint="Список моделей, из которых можно будет выбирать при запуске агента"
        />
        <div v-if="modelChoices.length" class="select-field">
          <label>Модель по умолчанию</label>
          <AppSelect v-model="agentForm.model" :options="modelDefaultOptions" placeholder="(не задано)" />
          <span class="hint">Подставляется автоматически, если не выбрать другую при запуске</span>
        </div>
      </template>

      <template v-if="hasReasoningPlaceholder">
        <TagListEditor
          v-model="agentForm.reasoning_options"
          label="Доступные уровни рассуждений"
          placeholder="high"
          hint="Список уровней, из которых можно будет выбирать при запуске агента"
        />
        <div v-if="reasoningChoices.length" class="select-field">
          <label>Уровень рассуждений по умолчанию</label>
          <AppSelect v-model="agentForm.reasoning_effort" :options="reasoningDefaultOptions" placeholder="(не задано)" />
          <span class="hint">Подставляется автоматически, если не выбрать другой при запуске</span>
        </div>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { api } from '@core/api'
import type { Agent } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import TagListEditor from '@shared/ui/TagListEditor.vue'
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
  name: '', command: '', update_command: '', args: '', env: '{}', skills_dir: '', skills_filename: 'plangent.md',
  model: '', reasoning_effort: '', model_options: [] as string[], reasoning_options: [] as string[],
})
const agentForm = ref(defaultAgentForm())

// Model/reasoning-effort pickers only appear once the developer has wired the
// corresponding {model}/{reasoning} placeholder into the args template themselves —
// see generic.ts launchAgent(), which substitutes them (or drops the flag if unset).
// The developer builds the list of choices themselves (TagListEditor); the "default"
// select just picks which one gets substituted automatically when nothing is
// overridden at launch time.
const hasModelPlaceholder = computed(() => agentForm.value.args.includes('{model}'))
const hasReasoningPlaceholder = computed(() => agentForm.value.args.includes('{reasoning}'))

const modelChoices = computed(() => [...new Set(agentForm.value.model_options.map(v => v.trim()).filter(Boolean))])
const reasoningChoices = computed(() => [...new Set(agentForm.value.reasoning_options.map(v => v.trim()).filter(Boolean))])
const modelDefaultOptions = computed(() => [{ value: '', label: '(не задано)' }, ...modelChoices.value.map(m => ({ value: m, label: m }))])
const reasoningDefaultOptions = computed(() => [{ value: '', label: '(не задано)' }, ...reasoningChoices.value.map(r => ({ value: r, label: r }))])

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
    update_command: a.update_command ?? '',
    args: a.args.join(' '),
    env: JSON.stringify(a.env, null, 2),
    skills_dir: a.skills_dir,
    skills_filename: a.skills_filename,
    model: a.model ?? '',
    reasoning_effort: a.reasoning_effort ?? '',
    model_options: [...(a.model_options ?? [])],
    reasoning_options: [...(a.reasoning_options ?? [])],
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
    update_command: agentForm.value.update_command.trim(),
    args: agentForm.value.args.trim() ? agentForm.value.args.trim().split(/\s+/) : [],
    env: envParsed,
    skills_dir: agentForm.value.skills_dir.trim(),
    skills_filename: agentForm.value.skills_filename.trim(),
    model: agentForm.value.model.trim(),
    reasoning_effort: agentForm.value.reasoning_effort.trim(),
    model_options: modelChoices.value,
    reasoning_options: reasoningChoices.value,
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

const updatingAgentId = ref<string | null>(null)

async function updateAgent(agent: Agent) {
  if (!agent.update_command) return
  updatingAgentId.value = agent.id
  try {
    await api.post(`/agents/${agent.id}/update`)
    appStore.toast(`${agent.name}: обновление завершено`, 'success')
  } catch (e: unknown) {
    appStore.toast(`${agent.name}: ${String(e)}`, 'error')
  } finally {
    updatingAgentId.value = null
  }
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

.select-field { display: flex; flex-direction: column; gap: 6px; }
.select-field > label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.select-field .hint { font-size: 11px; color: var(--text-faint); }
</style>
