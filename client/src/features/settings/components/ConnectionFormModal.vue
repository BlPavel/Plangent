<template>
  <AppModal :model-value="modelValue" size="large" :title="connection ? 'Подключение: ' + connection.name : 'Новое подключение'" :confirm-label="busy ? 'Сохранение…' : 'Сохранить'" @update:model-value="$emit('update:modelValue', $event)" @confirm="save">
    <ConnectionsGuide />
    <PresetPicker :presets="presets" :applied="applied" :note="CONNECTION.presetNote" @apply="applyPreset" />

    <fieldset class="group">
      <legend>Сервис</legend>
      <FormField v-model="form.name" label="Название" placeholder="Вики компании" :hint="CONNECTION.name" />
      <div class="stack">
        <FormField v-model="form.base_url" label="Адрес сервиса" placeholder="https://wiki.example.com" :hint="CONNECTION.baseUrl" />
        <p v-if="form.base_url.trim() && !origin" class="field-error">{{ CONNECTION.baseUrlInvalid }}</p>
        <div v-else-if="origin && origin !== form.base_url.trim()" class="suggest">
          <span>{{ CONNECTION.trimSuggestion(origin) }}</span>
          <AppButton size="xs" variant="blue" type="button" @click="form.base_url = origin">{{ CONNECTION.trimAction }}</AppButton>
        </div>
        <details class="find"><summary>Как узнать адрес</summary><p>{{ CONNECTION.baseUrlFind }}</p></details>
      </div>
      <FormField :model-value="form.code_host ?? ''" label="Хостинг кода" type="select" :hint="CONNECTION.codeHost" @update:model-value="form.code_host = String($event) || null">
        <option value="">Не хостинг (вики, трекер и т. п.)</option><option value="gitlab">GitLab</option><option value="github">GitHub</option>
      </FormField>
      <FormField v-model="form.organization_id" label="Организация" type="select" :hint="CONNECTION.organization">
        <option value="">Без организации</option><option v-for="o in organizations" :key="o.id" :value="o.id">{{ o.name }}</option>
      </FormField>
    </fieldset>

    <fieldset class="group">
      <legend>Учётная запись</legend>
      <FormField :model-value="form.auth_strategy" label="Способ входа" type="select" :hint="STRATEGIES[form.auth_strategy]?.hint" @update:model-value="setStrategy(String($event))">
        <option v-for="(s, key) in STRATEGIES" :key="key" :value="key">{{ s.label }}</option>
      </FormField>
      <FormField v-model="form.credential_mode" label="Учётная запись" type="select" :hint="CREDENTIAL_MODES[form.credential_mode]?.hint">
        <option v-for="(m, key) in CREDENTIAL_MODES" :key="key" :value="key">{{ m.label }}</option>
      </FormField>
      <template v-if="form.credential_mode === 'inherit'">
        <p v-if="!form.organization_id" class="notice warn">Выберите организацию или другой режим: без организации общей учётной записи нет.</p>
        <p v-else-if="!inherited" class="notice warn">У организации не выбрана общая учётная запись — задайте её в настройках организации.</p>
        <p v-else class="notice">Вход под «{{ inherited.name }}» ({{ inherited.username }}) · {{ accountState(inherited) }}</p>
      </template>
      <template v-if="form.credential_mode === 'credential'">
        <FormField v-model="form.credential_id" label="Запись" type="select" :hint="choices.length ? '' : 'В этой организации ещё нет учётных записей — создайте её кнопкой «+ Учётная запись».'">
          <option value="">Выберите</option>
          <option v-for="c in choices" :key="c.id" :value="c.id">{{ c.name }} · {{ c.username }} · {{ accountState(c) }}</option>
        </FormField>
      </template>
      <div v-if="form.credential_mode === 'own'" class="row">
        <FormField v-if="form.auth_strategy !== 'token'" v-model="form.username" label="Собственный логин" :hint="CONNECTION.ownUsername" />
        <FormField v-model="password" :label="form.auth_strategy === 'token' ? 'Токен' : 'Пароль'" type="password" :placeholder="ownHasSecret ? 'Сохранён — не меняется' : form.auth_strategy === 'token' ? 'glpat-…' : ''" :hint="form.auth_strategy === 'token' ? CONNECTION.ownToken : CONNECTION.ownPassword" />
      </div>
      <div v-if="isGitHub" class="gitlab">
        <div class="gitlab-row">
          <a class="btn btn-ghost btn-sm" href="https://github.com/settings/tokens/new?description=Plangent&amp;scopes=repo" target="_blank" rel="noopener noreferrer">Создать токен ↗</a>
        </div>
        <p class="hint">{{ CONNECTION.githubToken }}</p>
        <p class="hint">{{ CONNECTION.gitlabGit }}</p>
      </div>
      <div v-if="isGitLab" class="gitlab">
        <div class="gitlab-row">
          <a v-if="origin" class="btn btn-ghost btn-sm" :href="origin + '/-/user_settings/personal_access_tokens?name=Plangent&amp;scopes=api'" target="_blank" rel="noopener noreferrer">Создать токен ↗</a>
          <span v-else class="hint">Укажите адрес GitLab, чтобы создать токен.</span>
          <span class="gitlab-spacer" />
          <AppButton v-if="connection" type="button" size="sm" :disabled="busy" @click="checkSaved">{{ busy ? 'Проверка…' : 'Проверить' }}</AppButton>
          <span v-else class="hint">{{ CONNECTION.gitlabCheckFirst }}</span>
        </div>
        <p class="hint">{{ CONNECTION.gitlabToken }}</p>
        <p class="hint">{{ CONNECTION.gitlabGit }}</p>
        <div v-if="checkResult" role="status" class="check" :class="{ failed: !checkResult.ok }">
          <span>{{ checkResult.ok ? '✓' : '✕' }} {{ checkResult.message }}</span>
          <span v-if="checkResult.ok && (checkResult.user || checkResult.version || checkResult.token_expires_at)" class="check-meta">
            <template v-if="checkResult.user">Пользователь: {{ checkResult.user }}</template>
            <template v-if="checkResult.version"> · GitLab {{ checkResult.version }}</template>
            <template v-if="checkResult.token_expires_at"> · токен действует до {{ checkResult.token_expires_at }}</template>
          </span>
        </div>
      </div>
    </fieldset>

    <details class="group auth" :open="authOpen" @toggle="authOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        <span class="auth-title">{{ authOpen ? '▾' : '▸' }} {{ CONNECTION.authSummary }}</span>
        <span class="auth-sub">{{ STRATEGIES[form.auth_strategy]?.label || form.auth_strategy }}<template v-if="checkUrl"> · проверка: {{ checkUrl }}</template></span>
      </summary>
      <div class="auth-body">
        <p class="hint">{{ CONNECTION.authIntro }}</p>
        <template v-for="g in groups" :key="g.title">
          <h4>{{ g.title }}</h4>
          <SettingsFields v-model="form.auth_config" :fields="g.fields" :example="example?.auth_config" :example-name="example?.name" :base="origin" />
        </template>
        <details class="json">
          <summary>JSON целиком</summary>
          <p class="hint">{{ CONNECTION.json }}</p>
          <FormField :model-value="authText" type="textarea" :rows="12" @update:model-value="setAuthText" />
          <p v-if="authTextError" class="field-error">{{ CONNECTION.jsonInvalid }}</p>
        </details>
      </div>
    </details>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else class="hint">{{ CONNECTION.autoCheck }}</p>
  </AppModal>
</template>

<script setup lang="ts">
import ConnectionsGuide from '@shared/ui/ConnectionsGuide.vue'
import { computed, ref, watch } from 'vue'
import { api } from '@core/api'
import type { Connection, ConnectionCheck, Credential, IntegrationPreset, Organization } from '@core/models/integrations'
import AppModal from '@shared/ui/AppModal.vue'
import AppButton from '@shared/ui/AppButton.vue'
import FormField from '@shared/ui/FormField.vue'
import PresetPicker from '@shared/ui/PresetPicker.vue'
import SettingsFields from '@shared/ui/SettingsFields.vue'
import { errorText } from '@shared/utils/errorText'
import { CONNECTION, CREDENTIAL_MODES, CREDENTIAL_STATUS, ERRORS, STRATEGIES, authFields } from '../utils/connection-hints'

const props = defineProps<{
  modelValue: boolean
  connection: Connection | null
  organizationId?: string
  organizations: Organization[]
  credentials: Credential[]
  presets: IntegrationPreset[]
}>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; saved: [id: string, passwordChanged: boolean] }>()

const blank = () => ({ code_host: null as string | null, name: '', base_url: '', organization_id: '', credential_mode: 'own', credential_id: '', username: '', auth_strategy: 'basic', auth_config: { expect_json: true } as Record<string, unknown> })
const form = ref(blank())
const isGitHub = computed(() => form.value.code_host === 'github')
const isGitLab = computed(() => form.value.auth_strategy === 'token' && form.value.auth_config.check_path === '/api/v4/user')
const checkResult = ref<ConnectionCheck>()
async function checkSaved() {
  if (!props.connection || busy.value) return
  const id = await saveSettings(false)
  if (!id) return
  busy.value = true
  try { checkResult.value = await api.post<ConnectionCheck>('/integrations/connections/' + id + '/check') }
  catch (cause) { error.value = errorText(cause, ERRORS) } finally { busy.value = false }
}
// Saved settings are copies: editing the form must not touch the list or the preset.
const clone = (v: Record<string, unknown>) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>
const password = ref(''), ownHasSecret = ref(false)
const applied = ref(''), authOpen = ref(false), busy = ref(false), error = ref('')
const authText = ref(''), authTextError = ref(false)

watch(() => props.modelValue, async open => {
  checkResult.value = undefined; password.value = ''; error.value = ''; applied.value = ''; ownHasSecret.value = false; authTextError.value = false
  if (!open) return
  const c = props.connection
  form.value = c
    ? { ...blank(), code_host: c.code_host || null, name: c.name, base_url: c.base_url, organization_id: c.organization_id || '', credential_mode: c.credential_mode, credential_id: c.credential_id || '', auth_strategy: c.auth_strategy, auth_config: clone(c.auth_config) }
    : { ...blank(), organization_id: props.organizationId || '', credential_mode: props.organizationId ? 'inherit' : 'own' }
  // An unknown service starts from the manual settings; a known one from «Заполнить как».
  authOpen.value = !c && !props.presets.length
  if (c?.credential_mode === 'own') {
    try {
      const account = await api.get<Credential | null>('/integrations/connections/' + c.id + '/credential')
      if (props.connection?.id === c.id) { form.value.username = account?.username || ''; ownHasSecret.value = !!account?.hasSecret }
    } catch (e) { error.value = errorText(e, ERRORS) }
  }
}, { immediate: true })

const origin = computed(() => {
  try { const u = new URL(form.value.base_url.trim()); return ['http:', 'https:'].includes(u.protocol) ? u.origin : '' } catch { return '' }
})
const inherited = computed(() => props.credentials.find(c => c.id === props.organizations.find(o => o.id === form.value.organization_id)?.credential_id))
const choices = computed(() => props.credentials.filter(c => (c.organization_id || '') === form.value.organization_id))
const accountState = (c: Credential) => c.status === 'needs_update' ? CREDENTIAL_STATUS.needsUpdate.label : c.hasSecret ? CREDENTIAL_STATUS.ready.label : CREDENTIAL_STATUS.noSecret.label
const groups = computed(() => authFields(form.value.auth_strategy).filter(g => g.fields.some(f => !f.visible || f.visible(form.value.auth_config))))
const example = computed(() => props.presets.find(p => p.id === applied.value) ?? props.presets[0] ?? null)
const checkUrl = computed(() => {
  const p = form.value.auth_config.check_path
  return origin.value && typeof p === 'string' && p ? origin.value + (p.startsWith('/') ? '' : '/') + p : ''
})

// The JSON view and the fields edit the same object; while the JSON is invalid the fields keep the last good value.
let typedJson = false
watch(() => form.value.auth_config, c => {
  if (!typedJson) { authText.value = JSON.stringify(c, null, 2); authTextError.value = false }
  typedJson = false
}, { immediate: true })
function setAuthText(text: string) {
  authText.value = text
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error()
    authTextError.value = false
    typedJson = true
    form.value.auth_config = value as Record<string, unknown>
  } catch { authTextError.value = true }
}

/** What a preset puts into the plain fields; a value that is empty or still a preset default is replaced by the next preset. */
const PRESET_DEFAULTS: Record<string, { name: string; base_url: string }> = {
  'github-token': { name: 'GitHub', base_url: 'https://api.github.com' },
  'gitlab-token': { name: 'GitLab', base_url: '' },
}
const untouched = (value: string, key: 'name' | 'base_url') => !value.trim() || Object.values(PRESET_DEFAULTS).some(d => d[key] === value)
/** Switching the method by hand drops settings that belong to another method, so the saved settings stay valid. */
function setStrategy(next: string) {
  const config = clone(form.value.auth_config)
  if (next === 'token') {
    for (const key of ['strategies', 'login_path', 'username_field', 'password_field', 'fields', 'invalid_password', 'invalid_session']) delete config[key]
    if (typeof config.token_header !== 'string' || !config.token_header) { config.token_header = 'Authorization'; config.token_prefix = 'Bearer ' }
  } else {
    delete config.token_header; delete config.token_prefix
    if (next === 'auto' && !Array.isArray(config.strategies)) config.strategies = ['basic']
  }
  form.value.auth_strategy = next
  form.value.auth_config = config
  authTextError.value = false
  authOpen.value = true
}
function applyPreset(id: string) {
  const p = props.presets.find(p => p.id === id)
  if (!p) return
  form.value.code_host = p.code_host || null
  form.value.auth_strategy = p.auth_strategy
  form.value.auth_config = clone(p.auth_config)
  authTextError.value = false
  applied.value = id
  checkResult.value = undefined
  const defaults = PRESET_DEFAULTS[id]
  if (defaults) {
    form.value.credential_mode = 'own'
    form.value.username = 'token'
    if (untouched(form.value.name, 'name')) form.value.name = defaults.name
    if (untouched(form.value.base_url, 'base_url')) form.value.base_url = defaults.base_url
  } else {
    if (untouched(form.value.name, 'name')) form.value.name = ''
    if (untouched(form.value.base_url, 'base_url')) form.value.base_url = ''
  }
}

function validate(): string {
  const f = form.value
  if (!f.name.trim()) return 'Укажите название подключения.'
  if (!origin.value) return CONNECTION.baseUrlInvalid
  if (f.credential_mode === 'credential' && !f.credential_id) return 'Выберите учётную запись.'
  if (f.credential_mode === 'own' && f.auth_strategy !== 'token' && !f.username.trim()) return 'Укажите логин.'
  if (authTextError.value) return CONNECTION.jsonInvalid
  if (typeof f.auth_config.check_path !== 'string' || !f.auth_config.check_path.trim()) { authOpen.value = true; return 'Укажите путь проверки в «Параметрах входа» или нажмите «Заполнить как».' }
  return ''
}

async function saveSettings(close = true) {
  if (busy.value) return
  error.value = validate()
  if (error.value) return
  busy.value = true
  try {
    const f = form.value
    const normalized = await api.post<{ base_url: string }>('/integrations/normalize-url', { base_url: f.base_url.trim() })
    const data = {
      code_host: f.code_host, name: f.name.trim(), base_url: normalized.base_url, organization_id: f.organization_id || null,
      credential_mode: f.credential_mode, credential_id: f.credential_id || null,
      own_credential: { username: f.auth_strategy === 'token' ? 'token' : f.username.trim() }, auth_strategy: f.auth_strategy, auth_config: f.auth_config,
    }
    const saved = props.connection
      ? await api.patch<Connection>('/integrations/connections/' + props.connection.id, data)
      : await api.post<Connection>('/integrations/connections', data)
    const passwordChanged = f.credential_mode === 'own' && !!password.value
    // The password is a separate write-only request; it never travels with the settings.
    if (passwordChanged) { await api.put('/integrations/connections/' + saved.id + '/password', { password: password.value }); ownHasSecret.value = true }
    password.value = ''
    if (close) emit('saved', saved.id, passwordChanged)
    if (close) emit('update:modelValue', false)
    return saved.id
  } catch (e) {
    error.value = errorText(e, ERRORS)
    if (/параметр|путь|Пути|способ|поле/i.test(error.value)) authOpen.value = true
  } finally { busy.value = false }
}
async function save() { await saveSettings() }
</script>

<style scoped>
.group { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.group legend { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stack { display: flex; flex-direction: column; gap: 6px; }
.hint { font-size: 12px; line-height: 1.5; color: var(--text-muted); }
.field-error, .form-error { font-size: 12px; color: var(--danger-hover); }
.form-error { padding: 8px 12px; background: var(--danger-soft); border-radius: var(--radius-sm); }
.suggest { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; background: var(--blue-soft); border-radius: var(--radius-sm); font-size: 12px; color: var(--text); overflow-wrap: anywhere; }
.suggest span { flex: 1; min-width: 200px; }
.notice { font-size: 12px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--bg3); color: var(--text-muted); }
.notice.warn { background: var(--warning-soft); color: var(--warning-text); }
.find summary, .json summary { font-size: 11.5px; color: var(--blue-hover); cursor: pointer; width: fit-content; }
.find p { margin-top: 4px; padding: 6px 10px; border-left: 2px solid var(--border-strong); font-size: 11.5px; line-height: 1.5; color: var(--text-muted); }
.auth { display: block; padding-top: 12px; }
.auth > summary { cursor: pointer; display: flex; flex-direction: column; gap: 2px; list-style: none; }
.auth > summary::-webkit-details-marker { display: none; }
.auth-title { font-size: 13px; font-weight: 600; }
.auth-sub { font-size: 11.5px; color: var(--text-faint); overflow-wrap: anywhere; padding-left: 16px; }
.auth-body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.json { display: flex; flex-direction: column; gap: 6px; }
.gitlab { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: var(--bg3); border-radius: var(--radius-sm); }
.gitlab-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gitlab-row a.btn { text-decoration: none; }
.gitlab-spacer { flex: 1; }
.check { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; font-size: 12px; border-radius: var(--radius-sm); color: var(--accent-hover); background: var(--accent-soft); }
.check.failed { color: var(--danger-hover); background: var(--danger-soft); }
.check-meta { color: var(--text-muted); }
</style>
