<template>
  <div class="docs-fields">
    <ConnectionsGuide />
    <FormField v-model="connectionId" label="Подключение" type="select" :hint="FORM.connection">
      <option value="">Выберите</option>
      <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }} — {{ c.base_url }} ({{ CONNECTION_STATE[c.last_check_status] || c.last_check_status }})</option>
    </FormField>
    <div v-if="loaded && !connections.length" class="notice warn">
      <span>{{ FORM.noConnections }}</span>
      <AppButton size="xs" variant="ghost" type="button" @click="openSettings()">{{ FORM.openConnections }}</AppButton>
    </div>
    <div v-else-if="connection?.last_check_status === 'needs_update'" class="notice warn" role="alert">
      <span>{{ NEEDS_UPDATE.text }}</span>
      <AppButton size="xs" variant="update" type="button" @click="openSettings(connection.id)">{{ NEEDS_UPDATE.action }}</AppButton>
    </div>
    <p v-else-if="connection?.last_check_status === 'error' && connection.last_check_message" class="notice">Последняя проверка подключения: {{ connection.last_check_message }}</p>

    <PresetPicker :presets="presets" :applied="applied" :note="FORM.presetNote" @apply="applyPreset" />

    <details class="group manual" :open="manualOpen" @toggle="manualOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        <span class="manual-title">{{ manualOpen ? '▾' : '▸' }} {{ FORM.manualSummary }}</span>
        <span class="manual-sub">{{ summary }}</span>
      </summary>
      <div class="manual-body">
        <p class="hint">{{ FORM.manualIntro }}</p>
        <template v-for="g in SOURCE_GROUPS" :key="g.title">
          <h4>{{ g.title }}</h4>
          <SettingsFields :model-value="modelValue.docs_config" :fields="g.fields" :example="example?.config" :example-name="example?.name" :base="connection?.base_url" :vars="vars" @update:model-value="setConfig" />
        </template>
        <details class="json">
          <summary>JSON целиком</summary>
          <p class="hint">{{ FORM.json }}</p>
          <FormField :model-value="configText" type="textarea" :rows="16" @update:model-value="setConfigText" />
        </details>
        <p v-if="configError" class="error" role="alert">{{ FORM.jsonInvalid }}</p>
      </div>
    </details>

    <fieldset class="group">
      <legend>{{ SECTIONS.title }}</legend>
      <p class="hint">{{ SECTIONS.intro }}</p>
      <div class="add-row">
        <FormField v-model="input" :label="SECTIONS.input" placeholder="https://…/pages/12345 или 12345" />
        <AppButton variant="blue" type="button" :disabled="!!blocked || busy || !input.trim()" @click="add">{{ busy === 'add' ? 'Поиск…' : SECTIONS.add }}</AppButton>
        <AppButton variant="ghost" type="button" :disabled="!!blocked || busy || !input.trim()" :title="SECTIONS.probeHint" @click="probe">{{ busy === 'probe' ? 'Запрос…' : SECTIONS.probe }}</AppButton>
      </div>
      <p v-if="blocked" class="hint">{{ blocked }}</p>
      <div v-if="error" class="error-box" role="alert">
        <span>{{ error }}</span>
        <span v-if="expectedUrl" class="faint">Запрос документа: <code>{{ expectedUrl }}</code></span>
      </div>

      <div v-if="probeResult" class="probe">
        <div class="probe-head">
          <b>{{ SECTIONS.probe }}</b>
          <span :class="probeResult.missing.length ? 'warn' : 'ok'">{{ probeResult.missing.length ? `Не найдено полей: ${probeResult.missing.length}` : PROBE.ok }}</span>
          <AppButton size="xs" variant="subtle" type="button" @click="probeResult = null">Скрыть</AppButton>
        </div>
        <h5>{{ PROBE.urls }}</h5>
        <ol class="urls"><li v-for="u in probeResult.urls" :key="u"><code>{{ u }}</code></li></ol>
        <h5>{{ PROBE.fields }}</h5>
        <table>
          <tr v-for="(path, key) in configFields" :key="key" :class="{ missing: probeResult.missing.includes(path) }">
            <td>{{ FIELD_LABELS[key] || key }}</td>
            <td><code>{{ path }}</code></td>
            <td>{{ probeResult.missing.includes(path) ? PROBE.missing : short(probeResult.fields[key]) }}</td>
          </tr>
        </table>
        <ul v-if="probeResult.warnings.length" class="warnings"><li v-for="w in probeResult.warnings" :key="w">{{ errorText(w, WARNINGS) }}</li></ul>
        <h5>{{ PROBE.preview }}</h5>
        <pre v-if="probeResult.preview">{{ probeResult.preview }}</pre>
        <p v-else class="hint">{{ PROBE.emptyPreview }}</p>
      </div>

      <p v-if="!modelValue.docs_selection.length" class="hint empty">{{ SECTIONS.empty }}</p>
      <div v-for="s in modelValue.docs_selection" :key="s.id" class="selection">
        <div class="selection-head">
          <b>{{ titles[s.id] || s.id }}</b>
          <span class="faint">id {{ s.id }}</span>
          <AppButton size="xs" variant="danger-ghost" type="button" @click="remove(s.id)">{{ SECTIONS.remove }}</AppButton>
        </div>
        <label class="check"><input type="checkbox" :checked="s.include_descendants" :disabled="!hasChildren" @change="setDescendants(s.id, ($event.target as HTMLInputElement).checked)"> {{ SECTIONS.withChildren }}</label>
        <p v-if="!hasChildren" class="hint">{{ SECTIONS.noTree }}</p>
        <template v-else-if="s.include_descendants">
          <div v-if="s.excluded_ids?.length" class="chips">
            <span class="faint">{{ SECTIONS.excluded }}:</span>
            <span v-for="id in s.excluded_ids" :key="id" class="chip">{{ titles[id] || id }} <button type="button" :title="SECTIONS.restore" @click="toggleExcluded(s.id, id)">×</button></span>
          </div>
          <AppButton size="xs" variant="subtle" type="button" @click="flipTree(s.id)">{{ trees.has(s.id) ? SECTIONS.hideTree : SECTIONS.showTree }}</AppButton>
          <template v-if="trees.has(s.id)">
            <p class="hint">{{ SECTIONS.treeHint }}</p>
            <DocsTree :parent-id="s.id" :connection-id="connectionId" :config="modelValue.docs_config" :excluded="s.excluded_ids || []" @toggle="node => { titles[node.id] = node.title; toggleExcluded(s.id, node.id) }" />
          </template>
        </template>
      </div>
    </fieldset>
    <p class="hint">{{ FORM.afterSave }}</p>
  </div>
</template>

<script setup lang="ts">
import ConnectionsGuide from '@shared/ui/ConnectionsGuide.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@core/api'
import type { Connection, DocsForm, DocsNode, DocsPreset, DocsProbe } from '@core/models/integrations'
import FormField from '@shared/ui/FormField.vue'
import AppButton from '@shared/ui/AppButton.vue'
import PresetPicker from '@shared/ui/PresetPicker.vue'
import SettingsFields from '@shared/ui/SettingsFields.vue'
import { errorText } from '@shared/utils/errorText'
import DocsTree from './DocsTree.vue'
import { CONNECTION_STATE, ERRORS, FIELD_LABELS, FORM, NEEDS_UPDATE, PROBE, SECTIONS, SOURCE_GROUPS, WARNINGS } from '../utils/docs-hints'

const props = defineProps<{ modelValue: DocsForm }>()
const emit = defineEmits<{ 'update:modelValue': [value: DocsForm]; valid: [value: boolean] }>()
const router = useRouter()
const connections = ref<Connection[]>([]), presets = ref<DocsPreset[]>([]), loaded = ref(false)
const input = ref(''), error = ref(''), busy = ref<'' | 'add' | 'probe'>('')
const probeResult = ref<DocsProbe | null>(null)
const titles = ref<Record<string, string>>({}), trees = ref(new Set<string>())
const manualOpen = ref(false)

const update = (patch: Partial<DocsForm>) => emit('update:modelValue', { ...props.modelValue, ...patch })
const connectionId = computed({ get: () => props.modelValue.connection_id, set: v => update({ connection_id: v }) })
const connection = computed(() => connections.value.find(c => c.id === connectionId.value))
const config = computed(() => props.modelValue.docs_config)
const hasConfig = computed(() => Object.keys(config.value).length > 0)
const hasChildren = computed(() => !!config.value.children)
const configFields = computed(() => (config.value.fields ?? {}) as Record<string, string>)
// The preset whose values the form holds now; editing a value un-highlights it.
const applied = computed(() => presets.value.find(p => JSON.stringify(p.config) === JSON.stringify(config.value))?.id)
const example = computed(() => presets.value.find(p => p.id === applied.value) ?? presets.value[0] ?? null)
const blocked = computed(() => !connectionId.value ? 'Сначала выберите подключение.' : !hasConfig.value ? FORM.noConfig : '')
const summary = computed(() => {
  if (!hasConfig.value) return 'не заданы'
  const c = config.value
  return [`документ: ${c.document_endpoint || '—'}`, c.children ? 'дерево: есть' : 'без дерева', c.body_format === 'markdown' ? 'markdown' : 'HTML'].join(' · ')
})
// A bare id from the input fills {id} in path previews; otherwise a sample.
const sampleId = computed(() => /^[\w.-]+$/.test(input.value.trim()) ? input.value.trim() : '12345')
const vars = computed(() => ({ id: sampleId.value, title: 'Заголовок', scope: 'SPACE', offset: '0', limit: '100' }))
const expectedUrl = computed(() => {
  const p = config.value.document_endpoint
  if (!connection.value || typeof p !== 'string' || !/^[\w.-]+$/.test(input.value.trim())) return ''
  return connection.value.base_url + p.replace(/\{(\w+)\}/g, (m, k: string) => (vars.value as Record<string, string>)[k] ?? m)
})

// The JSON view and the fields edit the same object; while the JSON is invalid the form cannot be saved.
const configText = ref(''), configError = ref(false)
let typedJson = false
watch(config, c => {
  if (!typedJson) { configText.value = JSON.stringify(c, null, 2); configError.value = false; emit('valid', true) }
  typedJson = false
}, { immediate: true })
function setConfig(value: Record<string, unknown>) { update({ docs_config: value }); probeResult.value = null }
function setConfigText(text: string) {
  configText.value = text
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error()
    configError.value = false; emit('valid', true)
    typedJson = true
    setConfig(value as Record<string, unknown>)
  } catch { configError.value = true; emit('valid', false) }
}
function applyPreset(id: string) {
  const p = presets.value.find(p => p.id === id)
  if (p) setConfig(JSON.parse(JSON.stringify(p.config)))
}

function openSettings(fix?: string) { void router?.push({ path: '/settings', query: { tab: 'connections', ...(fix ? { fix } : {}) } }) }
const draft = () => ({ connection_id: connectionId.value, config: config.value, input: input.value.trim() })
async function run(kind: 'add' | 'probe', action: () => Promise<void>) {
  busy.value = kind; error.value = ''
  try { await action() } catch (e) { error.value = errorText(e, ERRORS) } finally { busy.value = '' }
}
async function probe() {
  probeResult.value = null
  await run('probe', async () => {
    const result = await api.post<Partial<DocsProbe>>('/projects/draft/docs/probe', draft())
    probeResult.value = { urls: [], fields: {}, missing: [], preview: '', warnings: [], ...result }
  })
}
async function add() {
  await run('add', async () => {
    const node = await api.post<DocsNode>('/projects/draft/docs/resolve', draft())
    titles.value[node.id] = node.title
    if (!props.modelValue.docs_selection.some(s => s.id === node.id)) update({ docs_selection: [...props.modelValue.docs_selection, { id: node.id, include_descendants: hasChildren.value }] })
    input.value = ''
  })
}
function short(v: unknown) {
  if (v === undefined || v === null) return '—'
  const text = typeof v === 'string' ? v : JSON.stringify(v)
  return text.length > 140 ? text.slice(0, 140) + '…' : text
}

const select = (map: (s: DocsForm['docs_selection'][number]) => DocsForm['docs_selection'][number]) => update({ docs_selection: props.modelValue.docs_selection.map(map) })
function remove(id: string) { update({ docs_selection: props.modelValue.docs_selection.filter(s => s.id !== id) }) }
function setDescendants(id: string, value: boolean) { select(s => s.id === id ? { ...s, include_descendants: value } : s) }
function toggleExcluded(root: string, id: string) {
  select(s => s.id !== root ? s : { ...s, excluded_ids: s.excluded_ids?.includes(id) ? s.excluded_ids.filter(v => v !== id) : [...(s.excluded_ids || []), id] })
}
function flipTree(id: string) { if (!trees.value.delete(id)) trees.value.add(id) }

onMounted(async () => {
  try {
    [connections.value, presets.value] = await Promise.all([api.get<Connection[]>('/integrations/connections'), api.get<DocsPreset[]>('/projects/draft/docs/presets')])
    loaded.value = true
    // An unknown service starts from the manual settings; a known one from «Заполнить как».
    manualOpen.value = !presets.value.length || (hasConfig.value && !applied.value)
    if (connectionId.value) await Promise.all(props.modelValue.docs_selection.map(async s => {
      try { const node = await api.post<DocsNode>('/projects/draft/docs/resolve', { connection_id: connectionId.value, config: config.value, input: s.id }); titles.value[s.id] = node.title } catch { /* Keep saved ids usable if the remote service is offline. */ }
    }))
  } catch (e) { error.value = errorText(e, ERRORS) }
})
</script>

<style scoped>
.docs-fields { display: flex; flex-direction: column; gap: 12px; }
.hint { font-size: 12px; color: var(--text-muted); line-height: 1.5; overflow-wrap: anywhere; }
.faint { color: var(--text-faint); font-size: 11.5px; }
.error { color: var(--danger-hover); font-size: 12px; }
code { padding: 1px 5px; background: var(--bg3); border-radius: 4px; font-size: 11px; overflow-wrap: anywhere; }
.notice { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; line-height: 1.5; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg3); color: var(--text-muted); }
.notice span { flex: 1; min-width: 220px; }
.notice.warn { background: var(--warning-soft); color: var(--warning-text); }
.group { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.group legend { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.manual { display: block; padding-top: 12px; }
.manual > summary { cursor: pointer; display: flex; flex-direction: column; gap: 2px; list-style: none; }
.manual > summary::-webkit-details-marker { display: none; }
.manual-title { font-size: 13px; font-weight: 600; }
.manual-sub { font-size: 11.5px; color: var(--text-faint); padding-left: 16px; overflow-wrap: anywhere; }
.manual-body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.json { display: flex; flex-direction: column; gap: 6px; }
.json summary { font-size: 11.5px; color: var(--blue-hover); cursor: pointer; width: fit-content; }
.add-row { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.add-row > :first-child { flex: 1; min-width: 240px; }
.error-box { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--danger-soft); border-radius: var(--radius-sm); font-size: 12px; color: var(--danger-hover); }
.probe { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px; }
.probe-head { display: flex; align-items: center; gap: 10px; }
.probe-head > span { flex: 1; }
.ok { color: var(--accent-hover); }
.warn { color: var(--warning-text); }
h5 { font-size: 11px; font-weight: 600; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
.urls { padding-left: 18px; display: flex; flex-direction: column; gap: 2px; }
table { border-collapse: collapse; width: 100%; }
td { padding: 3px 8px 3px 0; vertical-align: top; overflow-wrap: anywhere; }
td:first-child { white-space: nowrap; color: var(--text-muted); }
td:nth-child(2) code { white-space: nowrap; }
tr.missing td:last-child { color: var(--danger-hover); }
.warnings { padding-left: 18px; color: var(--warning-text); }
pre { max-height: 220px; overflow: auto; padding: 8px 10px; background: var(--bg3); border-radius: var(--radius-sm); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.selection { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12.5px; }
.selection > .btn { align-self: flex-start; }
.selection-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.selection-head b { overflow-wrap: anywhere; }
.selection-head .btn { margin-left: auto; }
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); font-size: 11.5px; text-decoration: line-through; color: var(--text-muted); }
.chip button { border: none; background: none; color: var(--text-muted); cursor: pointer; font-size: 13px; line-height: 1; padding: 0 4px; }
.chip button:hover { color: var(--text); }
.empty { font-style: italic; }
</style>
