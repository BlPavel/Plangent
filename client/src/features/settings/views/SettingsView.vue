<template>
  <div class="settings">
    <div class="settings-header app-drag">
      <h2>Настройки</h2>
    </div>

    <div class="settings-tabs">
      <button class="stab" :class="{ active: tab === 'agents' }" @click="tab = 'agents'">Агенты</button>
      <button class="stab" :class="{ active: tab === 'connections' }" @click="tab = 'connections'">Подключения</button>
      <button class="stab" :class="{ active: tab === 'skills' }" @click="tab = 'skills'">Скиллы</button>
      <button class="stab" :class="{ active: tab === 'plan-template' }" @click="tab = 'plan-template'">Шаблон плана</button>
      <button class="stab" :class="{ active: tab === 'instruction-guide' }" @click="tab = 'instruction-guide'">Руководство по инструкциям</button>
      <button class="stab" :class="{ active: tab === 'notes' }" @click="tab = 'notes'">Доработки</button>
    </div>

    <div v-if="tab === 'connections'" class="tab-body"><ConnectionsSettings :fix="typeof route.query.fix === 'string' ? route.query.fix : undefined" /></div>
    <!-- Agents -->
    <div v-show="tab === 'agents'" class="tab-body">
      <div class="section-header">
        <span class="section-title">Агенты</span>
        <AppButton variant="primary" size="sm" @click="openCreate()">+ Добавить агента</AppButton>
      </div>
      <p class="hint">Агенты подключаются по ACP (Agent Client Protocol). Plangent сам отвечает на их запросы разрешений, поэтому режимы «без подтверждений» агента не нужны.</p>

      <div class="agent-list">
        <div v-if="!agentsStore.agents.length" class="empty-state">
          Нет агентов. Добавьте первого.
        </div>
        <div v-for="a in agentsStore.agents" :key="a.id" class="agent-card">
          <div class="agent-top">
            <div>
              <span class="agent-name">{{ a.name }}</span>
              <code class="agent-cmd">{{ launchLine(a) }}</code>
            </div>
            <div class="actions">
              <AppButton variant="ghost" size="sm" :disabled="checking.has(a.id)" title="Запустить агента и узнать, что он умеет" @click="check(a)">
                {{ checking.has(a.id) ? 'Проверка…' : 'Проверить' }}
              </AppButton>
              <AppButton
                v-if="canUpdate(a)"
                variant="update"
                size="sm"
                :disabled="updatingAgentId === a.id"
                title="Обновить CLI агента и ACP-адаптер до последней версии"
                @click="updateAgent(a)"
              >
                {{ updatingAgentId === a.id ? 'Обновление…' : '⟳ Обновить' }}
              </AppButton>
              <AppButton variant="ghost" size="sm" @click="openEdit(a)">Изменить</AppButton>
              <AppButton variant="danger-ghost" size="sm" @click="remove(a.id)">
                <IconTrash /> Удалить
              </AppButton>
            </div>
          </div>
          <div class="agent-meta">
            <template v-if="report(a.id)?.ok">
              <span v-if="report(a.id)!.title">{{ report(a.id)!.title }}</span>
              <span>Моделей: {{ report(a.id)!.models }}</span>
              <span v-if="report(a.id)!.capabilities" :class="{ bad: !report(a.id)!.capabilities!.loadSession }">
                {{ report(a.id)!.capabilities!.loadSession ? 'Восстанавливает чаты' : 'Не восстанавливает чаты после перезапуска' }}
              </span>
              <span v-if="report(a.id)!.capabilities">MCP: {{ report(a.id)!.capabilities!.mcpHttp ? 'HTTP' : 'через stdio-мост' }}</span>
            </template>
            <span v-else-if="report(a.id)" class="bad" :title="report(a.id)!.error">Не запускается: {{ report(a.id)!.error }}</span>
            <span v-if="a.model">Модель: {{ a.model }}</span>
            <span v-if="a.reasoning_effort">Рассуждения: {{ a.reasoning_effort }}</span>
            <span v-if="Object.keys(a.env).length">Env: {{ Object.keys(a.env).join(', ') }}</span>
            <span v-if="a.layout_profile?.main">Инструкции → {{ a.layout_profile.main.file }}</span>
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

    <!-- Instruction authoring guide (global) -->
    <div v-show="tab === 'instruction-guide'" class="tab-body">
      <p class="hint">Глобальное руководство действует во всех проектах, если проект или группа не переопределили его во вкладке «Инструкции» → «Руководство для агента».</p>
      <InstructionGuideEditor scope="global" />
    </div>

    <!-- Personal improvement notes -->
    <div v-show="tab === 'notes'" class="tab-body">
      <ImprovementNotes />
    </div>

    <!-- Agent create/edit modal -->
    <AppModal
      v-model="showAgentModal"
      size="large"
      :title="editAgent ? 'Изменить агента' : 'Добавить агента'"
      confirm-label="Сохранить"
      @confirm="saveAgent"
    >
      <div class="presets">
        <span class="presets-label">Заполнить как:</span>
        <AppButton v-for="(p, key) in presets" :key="key" variant="ghost" size="sm" type="button" @click="applyPreset(p)">{{ p.name }}</AppButton>
        <template v-if="!Object.keys(presets).length">
          <span class="hint">{{ loadingPresets ? 'Загрузка пресетов…' : 'Не удалось загрузить пресеты.' }}</span>
          <AppButton v-if="!loadingPresets" variant="ghost" size="sm" @click="loadPresets">Повторить</AppButton>
        </template>
      </div>

      <fieldset class="group">
        <legend>Подключение</legend>
        <FormField v-model="agentForm.name" label="Название" placeholder="Claude Code" />
        <FormField v-model="agentForm.acp_command" label="Команда ACP-адаптера" placeholder="npx" hint="Процесс, который говорит с Plangent по ACP: сам CLI с флагом (gigacode --acp) или адаптер (npx @agentclientprotocol/…)" />
        <FormField v-model="agentForm.acp_args" label="Аргументы (JSON-массив)" placeholder='["--acp"]' />
        <FormField v-model="agentForm.env" label="Переменные окружения (JSON)" type="textarea" :rows="3" placeholder='{"HTTPS_PROXY": "http://proxy:8080", "OPENAI_API_KEY": "sk-..."}' hint="Добавляются к окружению при каждом запуске, вместе с переменными проекта. Адреса 127.0.0.1 и localhost всегда идут мимо прокси." />
      </fieldset>

      <fieldset class="group">
        <legend>По умолчанию</legend>
        <template v-if="editAgent && (defaults.models.length || defaults.efforts.length)">
          <div v-if="defaults.models.length" class="select-field">
            <label>Модель</label>
            <AppSelect v-model="agentForm.model" :options="[{ value: '', label: 'Как решит агент' }, ...defaults.models]" />
          </div>
          <div v-if="defaults.efforts.length" class="select-field">
            <label>Глубина рассуждений</label>
            <AppSelect v-model="agentForm.reasoning_effort" :options="[{ value: '', label: 'Как решит агент' }, ...defaults.efforts]" />
          </div>
          <span class="hint">Для новых чатов и шагов задачи; при запуске можно выбрать другое.</span>
        </template>
        <span v-else-if="editAgent && checking.has(editAgent.id)" class="hint">Узнаю у агента список моделей…</span>
        <span v-else class="hint">Списки моделей и уровней рассуждений агент сообщает сам. Сохраните агента и нажмите «Проверить» — тогда здесь можно будет выбрать значения по умолчанию.</span>
      </fieldset>

      <fieldset class="group">
        <legend>Инструкции и скиллы</legend>
        <p class="hint">Куда Plangent раскладывает инструкции проекта и скиллы, чтобы агент их прочитал. Пустое поле — не раскладывать.</p>
        <div class="row">
          <FormField v-model="agentForm.main_file" label="Файл инструкций в проекте" placeholder="CLAUDE.md" />
          <FormField v-model="agentForm.main_global" label="Глобальный файл инструкций" placeholder="~/.claude/CLAUDE.md" />
        </div>
        <div class="row">
          <FormField v-model="agentForm.skills_dir" label="Папка скиллов в проекте" placeholder=".claude/skills" />
          <FormField v-model="agentForm.skills_global" label="Глобальная папка скиллов" placeholder="~/.claude/skills" />
        </div>
        <label class="check"><input v-model="agentForm.commands_as_skills" type="checkbox" /> Команды класть как скиллы (агент не поддерживает отдельные команды)</label>
        <div v-if="!agentForm.commands_as_skills" class="row">
          <FormField v-model="agentForm.commands_dir" label="Папка команд в проекте" placeholder=".claude/commands" />
          <FormField v-model="agentForm.commands_global" label="Глобальная папка команд" placeholder="~/.claude/commands" />
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>Обслуживание</legend>
        <div class="row">
          <FormField v-model="agentForm.command" label="CLI агента" placeholder="claude" hint="Для чтения лимитов использования" />
          <FormField v-model="agentForm.update_command" label="Команда обновления" placeholder="npm update -g @vendor/agent" hint="Кнопка «Обновить». Пусто — кнопки нет" />
        </div>
      </fieldset>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@core/stores/app'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import { api } from '@core/api'
import type { Agent, AgentPreset, LayoutProfile } from '@core/models'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppButton from '@shared/ui/AppButton.vue'
import IconTrash from '@shared/ui/IconTrash.vue'
import { InstructionGuideEditor, PlanTemplateEditor, SkillsManager } from '@features/library'
import ConnectionsSettings from '../components/ConnectionsSettings.vue'
import ImprovementNotes from '../components/ImprovementNotes.vue'

const appStore = useAppStore()
const agentsStore = useAgentsStore()
const chatStore = useChatStore()

type Tab = 'agents' | 'skills' | 'plan-template' | 'instruction-guide' | 'notes' | 'connections'
// Other screens link straight to a tab, e.g. a docs source's «Изменить пароль» → ?tab=connections&fix=<id>.
const route = useRoute()
const tab = ref<Tab>(route.query.tab === 'connections' ? 'connections' : 'agents')
watch(() => route.query.tab, t => { if (t === 'connections') tab.value = t })

// ── Agents ────────────────────────────────────────────────────────────────────

const presets = ref<Record<string, AgentPreset>>({})
const loadingPresets = ref(true)
const showAgentModal = ref(false)
const editAgent = ref<Agent | null>(null)

const defaultAgentForm = () => ({
  name: '', acp_command: '', acp_args: '[]', env: '{}',
  model: '', reasoning_effort: '',
  main_file: '', main_global: '', skills_dir: '', skills_global: '',
  commands_as_skills: false, commands_dir: '', commands_global: '',
  command: '', update_command: '',
})
const agentForm = ref(defaultAgentForm())

// Seeded agents have no acp_command of their own and start from their preset.
const SEEDED: Record<string, string> = { 'agent-claude': 'claude', 'agent-codex': 'codex' }
function launchLine(a: Agent) {
  const p = a.acp_command ? a : presets.value[SEEDED[a.id]]
  const command = a.acp_command || p?.acp_command
  return command ? [command, ...(p?.acp_args ?? [])].join(' ') : 'ACP-команда не задана'
}

// What the agent reported about itself (via a throwaway ACP session).
const checking = ref(new Set<string>())
interface Report { ok: boolean; error?: string; title?: string; models?: number; capabilities?: { loadSession: boolean; mcpHttp: boolean } | null }
function report(agentId: string): Report | null {
  const source = chatStore.agentOptions[agentId]
  if (!source) return null
  if ('error' in source) return { ok: false, error: source.error }
  const s = source as typeof source & { agent?: { title?: string | null; name?: string; version?: string } | null; capabilities?: Report['capabilities'] }
  return { ok: true, title: [s.agent?.title || s.agent?.name, s.agent?.version].filter(Boolean).join(' '), models: modelAndEffort(source).models.length, capabilities: s.capabilities }
}
async function check(a: Agent, refresh = true) {
  checking.value.add(a.id)
  try { await chatStore.fetchAgentOptions(a.id, refresh) }
  finally { checking.value.delete(a.id) }
  const r = report(a.id)
  if (refresh && r) appStore.toast(r.ok ? `${a.name}: агент отвечает` : `${a.name}: ${r.error}`, r.ok ? 'success' : 'error')
}
const defaults = computed(() => modelAndEffort(editAgent.value ? chatStore.agentOptions[editAgent.value.id] : null))

function layoutToForm(layout: LayoutProfile | null) {
  return {
    main_file: layout?.main?.file ?? '', main_global: layout?.main?.global ?? '',
    skills_dir: layout?.skills?.dir ?? '', skills_global: layout?.skills?.global ?? '',
    commands_as_skills: !!layout?.commands?.asSkill,
    commands_dir: layout?.commands?.asSkill ? '' : layout?.commands?.dir ?? '',
    commands_global: layout?.commands?.asSkill ? '' : layout?.commands?.global ?? '',
  }
}
function formToLayout(): LayoutProfile | null {
  const f = agentForm.value, t = (v: string) => v.trim()
  const layout: LayoutProfile = {}
  if (t(f.main_file) || t(f.main_global)) layout.main = { file: t(f.main_file), global: t(f.main_global) }
  const skills = { dir: t(f.skills_dir), global: t(f.skills_global), file: 'plangent-<slug>/SKILL.md' }
  if (skills.dir || skills.global) layout.skills = skills
  if (f.commands_as_skills) { if (layout.skills) layout.commands = { ...skills, asSkill: true } }
  else if (t(f.commands_dir) || t(f.commands_global)) layout.commands = { dir: t(f.commands_dir), global: t(f.commands_global), file: 'plangent-<slug>.md' }
  return Object.keys(layout).length ? layout : null
}

function applyPreset(p: AgentPreset) {
  agentForm.value = {
    ...agentForm.value,
    name: agentForm.value.name || p.name,
    acp_command: p.acp_command, acp_args: JSON.stringify(p.acp_args),
    command: p.command, update_command: p.update_command,
    ...layoutToForm(p.layout_profile),
  }
}
function openCreate() {
  editAgent.value = null
  agentForm.value = defaultAgentForm()
  showAgentModal.value = true
}

function openEdit(a: Agent) {
  editAgent.value = a
  const p = presets.value[SEEDED[a.id]]
  agentForm.value = {
    name: a.name,
    // Show the preset a seeded agent actually runs with; saving makes it explicit.
    acp_command: a.acp_command || p?.acp_command || '',
    acp_args: JSON.stringify(a.acp_command ? a.acp_args : p?.acp_args ?? []),
    env: JSON.stringify(a.env, null, 2),
    model: a.model ?? '', reasoning_effort: a.reasoning_effort ?? '',
    ...layoutToForm(a.layout_profile),
    command: a.command, update_command: a.update_command ?? '',
  }
  showAgentModal.value = true
  if (!chatStore.agentOptions[a.id]) void check(a, false)
}

async function saveAgent() {
  let acpArgs: string[]
  try { acpArgs = JSON.parse(agentForm.value.acp_args || '[]'); if (!Array.isArray(acpArgs) || acpArgs.some(a => typeof a !== 'string')) throw new Error() }
  catch { appStore.toast('Аргументы должны быть JSON-массивом строк, например ["--acp"]', 'error'); return }
  let envParsed: Record<string, string> = {}
  try { envParsed = JSON.parse(agentForm.value.env || '{}') } catch {
    appStore.toast('Невалидный JSON в переменных окружения', 'error'); return
  }
  const f = agentForm.value
  const data = {
    name: f.name.trim(),
    acp_command: f.acp_command.trim(), acp_args: acpArgs, env: envParsed,
    model: f.model, reasoning_effort: f.reasoning_effort,
    layout_profile: formToLayout(),
    command: f.command.trim(), update_command: f.update_command.trim(),
  }
  try {
    if (editAgent.value) {
      const connectionChanged = JSON.stringify([editAgent.value.acp_command, editAgent.value.acp_args, editAgent.value.env]) !== JSON.stringify([data.acp_command, data.acp_args, data.env])
      await agentsStore.update(editAgent.value.id, data)
      if (connectionChanged) delete chatStore.agentOptions[editAgent.value.id]
      appStore.toast('Агент обновлён', 'success')
    } else {
      await agentsStore.create(data)
      appStore.toast('Агент добавлен — нажмите «Проверить», чтобы убедиться, что он запускается', 'success')
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

// Same shape the server looks for: an adapter package pinned to an exact version.
const PINNED_PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:-[\w.]+)?$/
const canUpdate = (a: Agent) => !!a.update_command.trim() || a.acp_args.some(arg => PINNED_PACKAGE.test(arg))

interface AgentUpdateResult {
  cli: { ok: true; output: string } | { ok: false; error: string } | null
  adapter: { ok: true; package: string; from: string; to: string } | { ok: false; package: string; error: string } | null
}

async function updateAgent(agent: Agent) {
  if (!canUpdate(agent)) return
  updatingAgentId.value = agent.id
  try {
    const { cli, adapter } = await api.post<AgentUpdateResult>(`/agents/${agent.id}/update`)
    const adapterBumped = adapter?.ok && adapter.from !== adapter.to
    if (adapterBumped) {
      await agentsStore.load()
      // Ask the new adapter version what it offers now (models, reasoning levels).
      await chatStore.fetchAgentOptions(agent.id, true)
    }
    const parts: string[] = []
    if (adapter) parts.push(!adapter.ok ? `адаптер не обновлён — ${adapter.error}` : adapterBumped ? `адаптер ${adapter.from} → ${adapter.to}` : 'адаптер уже актуален')
    if (cli) parts.push(cli.ok ? 'CLI обновлён' : `CLI не обновлён — ${cli.error}`)
    const models = adapterBumped ? report(agent.id) : null
    if (models?.ok) parts.push(`моделей: ${models.models}`)
    else if (models) parts.push(`агент не запускается: ${models.error}`)
    const failed = adapter?.ok === false || cli?.ok === false || models?.ok === false
    appStore.toast(`${agent.name}: ${parts.join(', ')}`, failed ? 'error' : 'success')
  } catch (e: unknown) {
    appStore.toast(`${agent.name}: ${String(e)}`, 'error')
  } finally {
    updatingAgentId.value = null
  }
}

// Show what each agent last reported (cached on the server; no agent is started for this).
watch(() => agentsStore.agents.map(a => a.id), ids => {
  for (const id of ids) if (!chatStore.agentOptions[id]) void chatStore.fetchAgentOptions(id, 'cached')
}, { immediate: true })

async function loadPresets() {
  loadingPresets.value = true
  try { presets.value = await api.get<Record<string, AgentPreset>>('/agents/presets') }
  catch (e) { appStore.toast(String(e), 'error') }
  finally { loadingPresets.value = false }
}

onMounted(() => {
  void agentsStore.load()
  void loadPresets()
})
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
.agent-meta .bad { color: var(--danger-hover); }
.actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.hint { font-size: 12px; color: var(--text-muted); }

.presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.presets-label { font-size: 12px; color: var(--text-muted); }

.group { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.group legend { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); }

.select-field { display: flex; flex-direction: column; gap: 6px; }
.select-field > label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
</style>
