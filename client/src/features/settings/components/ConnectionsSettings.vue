<template>
  <div class="connections">
    <div class="section-header">
      <span class="section-title">Подключения</span>
      <div class="actions">
        <AppButton size="sm" variant="ghost" @click="openOrganization()">+ Организация</AppButton>
        <AppButton size="sm" variant="ghost" @click="openCredential()">+ Учётная запись</AppButton>
        <AppButton size="sm" variant="primary" @click="openConnection()">+ Подключение</AppButton>
      </div>
    </div>
    <ConnectionsGuide />
    <p class="hint">{{ INTRO }}</p>

    <div v-if="storage && !storage.available" class="banner error" role="alert">{{ STORAGE.unavailable }}</div>
    <div v-else-if="storage?.insecure_dev_storage" class="banner warn">{{ STORAGE.insecureDev }}</div>
    <div v-if="broken.length" class="banner warn" role="alert">
      <span>{{ NEEDS_UPDATE.banner(broken.map(b => '«' + b.name + '»').join(', ')) }}</span>
      <AppButton v-for="b in broken" :key="b.kind + b.id" size="xs" variant="update" @click="openPassword(b.kind, b.id, b.name)">{{ NEEDS_UPDATE.action }}<template v-if="broken.length > 1">: {{ b.name }}</template></AppButton>
    </div>

    <p v-if="loading && !loaded" class="empty-state">Загрузка…</p>
    <div v-else-if="loadError" class="banner error" role="alert">
      <span>Не удалось загрузить подключения: {{ loadError }}</span>
      <AppButton size="xs" variant="ghost" @click="reload">Повторить</AppButton>
    </div>
    <div v-else-if="!organizations.length && !credentials.length && !connections.length" class="empty">
      <b>{{ EMPTY.title }}</b>
      <ol><li v-for="s in EMPTY.steps" :key="s">{{ s }}</li></ol>
      <p class="hint">{{ EMPTY.organizations }}</p>
      <div class="actions"><AppButton size="sm" variant="primary" @click="openConnection()">Добавить подключение</AppButton></div>
    </div>

    <AppItemCard v-for="g in groups" :key="g.org?.id || 'none'" as="section">
      <template #title>{{ g.org ? g.org.name : 'Без организации' }}</template>
      <template v-if="g.org" #subtitle>Общая учётная запись: {{ credentialName(g.org.credential_id) || 'не выбрана' }}</template>
      <template #actions>
        <AppButton size="xs" variant="subtle" @click="openCredential(undefined, g.org?.id)">+ Учётная запись</AppButton>
        <AppButton size="xs" variant="subtle" @click="openConnection(undefined, g.org?.id)">+ Подключение</AppButton>
        <template v-if="g.org">
          <AppButton size="xs" variant="ghost" @click="openOrganization(g.org)">Изменить</AppButton>
          <AppButton size="xs" variant="danger-ghost" @click="removeOrganization(g.org)">Удалить</AppButton>
        </template>
      </template>

      <p v-if="!g.connections.length && !g.credentials.length" class="hint">Пусто: добавьте учётную запись или подключение.</p>

      <AppItemCard v-for="c in g.connections" :key="c.id" nested>
        <template #title>
          <span>{{ c.name }}</span>
          <AppBadge :tone="STATUS[status(c)]?.tone">{{ STATUS[status(c)]?.label || status(c) }}</AppBadge>
        </template>
        <template #subtitle><code>{{ c.base_url }}</code> · {{ STRATEGIES[c.auth_strategy]?.label || c.auth_strategy }} · {{ accountLabel(c) }}</template>
        <template #actions>
          <AppButton v-if="passwordTarget(c)" size="sm" :variant="status(c) === 'needs_update' || noPassword(c) ? 'update' : 'ghost'" @click="fixPassword(c)">{{ noPassword(c) ? 'Задать' : 'Изменить' }} {{ secretWord(c).acc }}</AppButton>
          <AppButton size="sm" variant="ghost" :disabled="checks[c.id]?.running" title="Войти и запросить текущего пользователя" @click="check(c.id)">{{ checks[c.id]?.running ? 'Проверка…' : 'Проверить' }}</AppButton>
          <AppButton size="sm" variant="ghost" @click="openConnection(c)">Изменить</AppButton>
          <AppButton size="sm" variant="danger-ghost" @click="removeConnection(c)">Удалить</AppButton>
        </template>
        <div v-if="checks[c.id]?.running" class="item-message">Проверка: вход и запрос «кто я»…</div>
        <template v-else-if="checks[c.id]?.result">
          <div class="item-message" :class="checks[c.id]!.result!.ok ? 'ok' : 'error'">{{ checks[c.id]!.result!.ok ? '✓ ' : '' }}{{ checkText(checks[c.id]!.result!.status, checks[c.id]!.result!.message, checks[c.id]!.result!.url) }}</div>
          <div v-if="checks[c.id]!.result!.url" class="item-message item-url">Запрос: <code>{{ checks[c.id]!.result!.url }}</code></div>
        </template>
        <div v-else-if="c.last_check_message" class="item-message" :class="STATUS[c.last_check_status]?.tone">
          {{ c.last_check_message }}<span v-if="c.last_check_at" class="faint"> · {{ formatDateTime(c.last_check_at) }}</span>
        </div>
        <div v-else-if="noPassword(c)" class="item-message warn">{{ secretWord(c).Nom }} не задан — вход невозможен.</div>
      </AppItemCard>

      <AppItemCard v-for="c in g.credentials" :key="c.id" nested>
        <template #title>
          <span>{{ c.name }}</span>
          <AppBadge :tone="credentialStatus(c).tone">{{ credentialStatus(c).label }}</AppBadge>
        </template>
        <template #subtitle>Учётная запись · логин {{ c.username }} · {{ usage(c.id) ? 'используют подключения: ' + usage(c.id) : 'не используется' }}</template>
        <template #actions>
          <AppButton size="sm" :variant="c.status === 'needs_update' || !c.hasSecret ? 'update' : 'ghost'" @click="openPassword('credentials', c.id, c.name)">{{ c.hasSecret ? 'Изменить пароль' : 'Задать пароль' }}</AppButton>
          <AppButton size="sm" variant="ghost" @click="openCredential(c)">Изменить</AppButton>
          <AppButton size="sm" variant="danger-ghost" @click="removeCredential(c)">Удалить</AppButton>
        </template>
      </AppItemCard>
    </AppItemCard>

    <AppModal v-model="organizationOpen" :title="organizationForm.id ? 'Организация' : 'Новая организация'" @confirm="saveOrganization">
      <FormField v-model="organizationForm.name" label="Название" placeholder="Компания A" :hint="ORGANIZATION.name" />
      <FormField v-if="organizationForm.id" v-model="organizationForm.credential_id" label="Общая учётная запись" type="select" :hint="ORGANIZATION.credential">
        <option value="">Не выбрана</option>
        <option v-for="c in credentials.filter(c => c.organization_id === organizationForm.id)" :key="c.id" :value="c.id">{{ c.name }} · {{ c.username }}</option>
      </FormField>
      <p v-else class="hint">{{ ORGANIZATION.credentialAfterSave }}</p>
    </AppModal>

    <AppModal v-model="credentialOpen" :title="credentialForm.id ? 'Учётная запись' : 'Новая учётная запись'" @confirm="saveCredential">
      <FormField v-model="credentialForm.organization_id" label="Организация" type="select" :disabled="!!credentialForm.id" :hint="CREDENTIAL.organization">
        <option value="">Без организации</option><option v-for="o in organizations" :key="o.id" :value="o.id">{{ o.name }}</option>
      </FormField>
      <FormField v-model="credentialForm.name" label="Название" :placeholder="credentialForm.username || 'Доменная учётка'" :hint="CREDENTIAL.name" />
      <div class="row">
        <FormField v-model="credentialForm.username" label="Логин" :hint="CREDENTIAL.username" />
        <FormField v-model="password" label="Пароль" type="password" :placeholder="credentialHasSecret ? 'Сохранён — не меняется' : ''" :hint="credentialForm.id ? CREDENTIAL.password : CREDENTIAL.passwordNew" />
      </div>
    </AppModal>

    <ConnectionFormModal
      v-model="connectionOpen" :connection="editingConnection" :organization-id="connectionOrganization"
      :organizations="organizations" :credentials="credentials" :presets="presets"
      @saved="connectionSaved"
    />

    <AppModal v-model="passwordOpen" :title="(passwordFor.token ? 'Новый токен: ' : 'Новый пароль: ') + passwordFor.name" @confirm="savePassword">
      <FormField v-model="password" :label="passwordFor.token ? 'Новый токен' : 'Новый пароль'" type="password" :hint="(passwordFor.token ? 'Токен' : 'Пароль') + ' шифруется и больше никогда не показывается. После сохранения зависимые подключения будут проверены заново.'" />
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import { AppItemCard } from '@shared/ui'
import { settingsEndpoints } from '../api'
import { projectsEndpoints } from '@features/projects'

import ConnectionsGuide from './ConnectionsGuide.vue'
import { computed, onMounted, ref, watch } from 'vue'

import { useAppStore } from '@core/stores/app'
import type { Organization, Credential, Connection, ConnectionCheck, IntegrationPreset, SecretStorage } from '@contracts'

import AppButton from '@shared/ui/AppButton.vue'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import { errorText } from '@shared/utils/errorText'
import { formatDateTime } from '@shared/utils/datetime'
import ConnectionFormModal from './ConnectionFormModal.vue'
import { CONFIRM, CREDENTIAL, CREDENTIAL_STATUS, EMPTY, ERRORS, INTRO, NEEDS_UPDATE, ORGANIZATION, STATUS, STORAGE, STRATEGIES, checkText } from '../utils/connection-hints'

/** fix: id of a connection whose password the user came to change (from a source's warning). */
const props = defineProps<{ fix?: string }>()
const app = useAppStore()
const organizations = ref<Organization[]>([]), credentials = ref<Credential[]>([]), connections = ref<Connection[]>([])
const presets = ref<IntegrationPreset[]>([]), storage = ref<SecretStorage>()
// Own accounts are hidden from the credentials list; fetched per connection to show their state.
const ownAccounts = ref<Record<string, Credential | null>>({})
const checks = ref<Record<string, { running?: boolean; result?: ConnectionCheck }>>({})
const loading = ref(false), loaded = ref(false), loadError = ref('')

async function load() {
  const [o, c, n, p, s] = await Promise.all([
    settingsEndpoints.getIntegrationsOrganizations({ params: {  } }), settingsEndpoints.getIntegrationsCredentials({ params: {  } }),
    settingsEndpoints.getIntegrationsConnections({ params: {  } }), settingsEndpoints.getIntegrationsPresets({ params: {  } }),
    settingsEndpoints.getIntegrationsStorage({ params: {  } }),
  ])
  organizations.value = o; credentials.value = c; connections.value = n; presets.value = p; storage.value = s
  const own = await Promise.all(n.filter(x => x.credential_mode === 'own').map(async x => [x.id, await settingsEndpoints.getIntegrationsConnectionsByIdCredential({ params: { id: x.id } }).catch(() => null)] as const))
  ownAccounts.value = Object.fromEntries(own)
  loaded.value = true
}
async function reload() {
  loading.value = true; loadError.value = ''
  try { await load() } catch (e) { loadError.value = errorText(e, ERRORS) } finally { loading.value = false }
}
/** Runs a change, shows its error as a toast and refreshes the lists. */
async function run(action: () => Promise<void>): Promise<boolean> {
  try { await action(); return true } catch (e) { app.toast(errorText(e, ERRORS), 'error'); return false } finally { await reload() }
}

const groups = computed(() => [
  ...organizations.value.map(o => ({ org: o as Organization | null, credentials: credentials.value.filter(c => c.organization_id === o.id), connections: connections.value.filter(c => c.organization_id === o.id) })),
  { org: null, credentials: credentials.value.filter(c => !c.organization_id), connections: connections.value.filter(c => !c.organization_id) },
].filter(g => g.org || g.credentials.length || g.connections.length))

const credentialName = (id: string | null) => credentials.value.find(c => c.id === id)?.name
function account(c: Connection): Credential | null | undefined {
  if (c.credential_mode === 'own') return ownAccounts.value[c.id]
  if (c.credential_mode === 'credential') return credentials.value.find(x => x.id === c.credential_id)
  return credentials.value.find(x => x.id === organizations.value.find(o => o.id === c.organization_id)?.credential_id)
}
function accountLabel(c: Connection) {
  const a = account(c)
  if (c.credential_mode === 'own') return 'свой логин' + (a?.username ? ' ' + a.username : '')
  if (!a) return c.credential_mode === 'inherit' ? 'учётная запись организации не выбрана' : 'учётная запись не найдена'
  return (c.credential_mode === 'inherit' ? 'от организации: ' : '') + a.name
}
const status = (c: Connection) => account(c)?.status === 'needs_update' ? 'needs_update' : c.last_check_status
/** A token-based connection signs in with a token: the buttons and dialog should say so. */
const secretWord = (c: Connection) => c.auth_strategy === 'token' ? { Nom: 'Токен', acc: 'токен', Acc: 'Токен' } : { Nom: 'Пароль', acc: 'пароль', Acc: 'Пароль' }
const noPassword = (c: Connection) => { const a = account(c); return !!a && !a.hasSecret }
function credentialStatus(c: Credential) {
  return c.status === 'needs_update' ? CREDENTIAL_STATUS.needsUpdate : c.hasSecret ? CREDENTIAL_STATUS.ready : CREDENTIAL_STATUS.noSecret
}
const usage = (credentialId: string) => connections.value.filter(c => c.credential_mode !== 'own' && account(c)?.id === credentialId).length
/** Where «Изменить пароль» of a connection writes: its own account or the shared one it signs in with. */
function passwordTarget(c: Connection): { kind: string; id: string; name: string } | null {
  if (c.credential_mode === 'own') return { kind: 'connections', id: c.id, name: c.name }
  const a = account(c)
  return a ? { kind: 'credentials', id: a.id, name: a.name } : null
}
function fixPassword(c: Connection) { const t = passwordTarget(c); if (t) openPassword(t.kind, t.id, t.name, c.auth_strategy === 'token') }
/** Accounts whose password stopped working, once each, for the banner. */
const broken = computed(() => {
  const seen = new Map<string, { kind: string; id: string; name: string }>()
  for (const c of credentials.value) if (c.status === 'needs_update') seen.set(c.id, { kind: 'credentials', id: c.id, name: c.name })
  for (const c of connections.value) if (c.credential_mode === 'own' && status(c) === 'needs_update') seen.set(c.id, { kind: 'connections', id: c.id, name: c.name })
  return [...seen.values()]
})

// ── Organizations and accounts ───────────────────────────────────────────────
const organizationOpen = ref(false), credentialOpen = ref(false), passwordOpen = ref(false)
const organizationForm = ref({ id: '', name: '', credential_id: '' })
const credentialForm = ref({ id: '', name: '', organization_id: '', username: '' })
const credentialHasSecret = ref(false)
const password = ref(''), passwordFor = ref({ kind: '', id: '', name: '', token: false })
// A typed password never outlives its dialog.
watch([passwordOpen, credentialOpen], () => { password.value = '' })

function openOrganization(o?: Organization) { organizationForm.value = { id: o?.id || '', name: o?.name || '', credential_id: o?.credential_id || '' }; organizationOpen.value = true }
function openCredential(c?: Credential, organizationId?: string) {
  credentialForm.value = { id: c?.id || '', name: c?.name || '', username: c?.username || '', organization_id: c?.organization_id || organizationId || '' }
  credentialHasSecret.value = !!c?.hasSecret
  credentialOpen.value = true
}
async function saveOrganization() {
  const f = organizationForm.value
  if (!f.name.trim()) return app.toast('Укажите название организации', 'error')
  await run(async () => {
    const data = { name: f.name.trim(), credential_id: f.credential_id || null }
    if (f.id) await settingsEndpoints.patchIntegrationsOrganizationsById({ params: { id: f.id }, body: data }); else await settingsEndpoints.postIntegrationsOrganizations({ params: {  }, body: data })
    organizationOpen.value = false
  })
}
async function saveCredential() {
  const f = credentialForm.value
  if (!f.username.trim()) return app.toast('Укажите логин', 'error')
  const secret = password.value
  const ok = await run(async () => {
    const data = { name: f.name.trim() || f.username.trim(), username: f.username.trim(), organization_id: f.organization_id || null }
    const saved = f.id ? await settingsEndpoints.patchIntegrationsCredentialsById({ params: { id: f.id }, body: data }) : await settingsEndpoints.postIntegrationsCredentials({ params: {  }, body: data })
    // The password is a separate write-only request; it never travels with the account.
    if (secret) await settingsEndpoints.putIntegrationsCredentialsByIdPassword({ params: { id: saved.id }, body: { password: secret } })
    credentialOpen.value = false
    // A new organization's first account becomes its shared one, so «От организации» works right away.
    const org = organizations.value.find(o => o.id === data.organization_id)
    if (!f.id && org && !org.credential_id) await settingsEndpoints.patchIntegrationsOrganizationsById({ params: { id: org.id }, body: { name: org.name, credential_id: saved.id } })
  })
  if (ok && secret && f.id) await recheck('credentials', f.id)
}

function openPassword(kind: string, id: string, name = '', token = false) { password.value = ''; passwordFor.value = { kind, id, name, token }; passwordOpen.value = true }
async function savePassword() {
  if (!password.value) return app.toast(passwordFor.value.token ? 'Введите токен' : 'Введите пароль', 'error')
  const { kind, id } = passwordFor.value
  const ok = await run(async () => { await settingsEndpoints.savePassword(kind, id, password.value); passwordOpen.value = false; password.value = '' })
  if (ok) await recheck(kind, id)
}
/** After a new password, check what signs in with it: the user sees at once whether it works. */
async function recheck(kind: string, id: string) {
  const targets = kind === 'connections' ? connections.value.filter(c => c.id === id) : connections.value.filter(c => c.credential_mode !== 'own' && account(c)?.id === id)
  for (const c of targets) await check(c.id, false)
  if (targets.length) await reload()
}

// ── Connections ───────────────────────────────────────────────────────────────
const connectionOpen = ref(false), editingConnection = ref<Connection | null>(null), connectionOrganization = ref('')
function openConnection(c?: Connection, organizationId?: string) {
  editingConnection.value = c ?? null
  connectionOrganization.value = organizationId || ''
  connectionOpen.value = true
}
async function connectionSaved(id: string, passwordChanged: boolean) {
  delete checks.value[id]
  await reload()
  const c = connections.value.find(c => c.id === id)
  if (c && (passwordChanged || account(c)?.hasSecret)) await check(id)
}
async function check(id: string, refresh = true) {
  checks.value[id] = { running: true }
  try { checks.value[id] = { result: await settingsEndpoints.postIntegrationsConnectionsByIdCheck({ params: { id: id } }) } }
  catch (e) { checks.value[id] = { result: { ok: false, status: 'error', message: errorText(e, ERRORS), url: '' } } }
  if (refresh) await reload()
}

async function removeOrganization(o: Organization) {
  if (await app.confirm(CONFIRM.organization(o.name), { confirmLabel: 'Удалить', danger: true })) await run(async () => { await settingsEndpoints.deleteIntegrationsOrganizationsById({ params: { id: o.id } }) })
}
async function removeCredential(c: Credential) {
  if (await app.confirm(CONFIRM.credential(c.name, usage(c.id)), { confirmLabel: 'Удалить', danger: true })) await run(async () => { await settingsEndpoints.deleteIntegrationsCredentialsById({ params: { id: c.id } }) })
}
async function removeConnection(c: Connection) {
  if (!(await app.confirm(CONFIRM.connection(c.name), { confirmLabel: 'Удалить', danger: true }))) return
  try { await settingsEndpoints.deleteIntegrationsConnectionsById({ params: { id: c.id } }); await reload() }
  catch (e) {
    if (!/used by a source/.test(String(e))) return app.toast(errorText(e, ERRORS), 'error')
    // Name the sources that hold the connection, so the user knows where to go.
    const sources = await projectsEndpoints.getProjects({ params: {  } }).then(ps => ps.filter(p => p.connection_id === c.id).map(p => '@' + p.key).join(', ')).catch(() => '')
    app.toast(CONFIRM.inUse(sources), 'error')
  }
}

onMounted(async () => {
  await reload()
  const c = connections.value.find(c => c.id === props.fix)
  if (c) fixPassword(c)
})
</script>

<style scoped>
.connections { display: flex; flex-direction: column; gap: var(--sp-4); }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.section-title { font-weight: 600; font-size: var(--fs-base); }
.actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
.hint { font-size: var(--fs-sm); line-height: 1.5; color: var(--text-muted); overflow-wrap: anywhere; }
.empty-state { color: var(--text-muted); font-size: var(--fs-md); }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: var(--radius); font-size: var(--fs-md); line-height: 1.5; border: 1px solid; }
.banner > span { flex: 1; min-width: 240px; }
.banner.warn { background: var(--warning-soft); border-color: var(--warning-outline); color: var(--warning-text); }
.banner.error { background: var(--danger-soft); border-color: var(--danger-outline); color: var(--danger-hover); }

.empty { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border: 1px dashed var(--border-strong); border-radius: var(--radius); font-size: var(--fs-md); }
.empty ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.5; }
.empty .actions { justify-content: flex-start; }

.item-message { font-size: var(--fs-sm); line-height: 1.45; color: var(--text-muted); overflow-wrap: anywhere; }
.item-message.ok { color: var(--accent-hover); }
.item-message.error { color: var(--danger-hover); }
.item-message.warn { color: var(--warning-text); }
.item-message.item-url { color: var(--text-faint); }
.faint { color: var(--text-faint); }
code { padding: 1px 5px; background: var(--bg3); border-radius: var(--radius-4); font-size: var(--fs-sm); }

.badge { padding: 1px 8px; border-radius: var(--radius-pill); font-size: var(--fs-xs); font-weight: 500; border: 1px solid var(--border-strong); color: var(--text-muted); white-space: nowrap; }
.badge.ok { color: var(--accent-hover); background: var(--accent-soft); border-color: var(--accent-outline); }
.badge.warn { color: var(--warning-text); background: var(--warning-soft); border-color: var(--warning-outline); }
.badge.error { color: var(--danger-hover); background: var(--danger-soft); border-color: var(--danger-outline); }
</style>
