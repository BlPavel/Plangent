<template>
  <div class="settings-fields">
    <template v-for="f in shown" :key="f.path">
      <div v-if="f.kind === 'bool'" class="field">
        <label class="check"><input type="checkbox" :checked="getPath(modelValue, f.path) === true" @change="setBool(f, ($event.target as HTMLInputElement).checked)"> {{ f.label }}</label>
        <p class="help">{{ f.hint }}</p>
      </div>
      <div v-else class="field" :class="{ mono: f.kind !== 'select' }" @focusout="settle(f)">
        <FormField
          :model-value="display(f)"
          :label="f.required ? f.label + ' *' : f.label"
          :type="f.kind === 'select' ? 'select' : f.kind === 'json' || f.kind === 'pairs' ? 'textarea' : 'text'"
          :rows="f.kind === 'json' ? 8 : 3"
          :placeholder="f.placeholder"
          @update:model-value="input(f, $event)"
        >
          <option v-for="o in f.options || []" :key="o.value" :value="o.value">{{ o.label }}</option>
        </FormField>
        <p class="help">{{ f.hint }}</p>
        <p v-if="errors[f.path]" class="field-error">{{ errors[f.path] }}</p>
        <p v-else-if="preview(f)" class="preview">Итоговый URL: <code>{{ preview(f) }}</code></p>
        <p v-if="exampleOf(f)" class="help">Пример{{ exampleName ? ` из «${exampleName}»` : '' }}: <code>{{ exampleOf(f) }}</code></p>
        <details v-if="f.find" class="find"><summary>Как узнать для своего сервиса</summary><p>{{ f.find }}</p></details>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getPath, setPath } from '@shared/utils/objectPath'
import FormField from './FormField.vue'

/**
 * One field of a settings object edited by dot path.
 * path: relative URL path, glued to `base` for the preview; list: "a, b"; numbers: "401, 403";
 * pairs: "name: value" per line; json: any JSON value.
 */
export interface SettingField {
  path: string
  label: string
  hint: string
  find?: string
  kind?: 'text' | 'path' | 'list' | 'numbers' | 'pairs' | 'number' | 'bool' | 'select' | 'json'
  options?: { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  /** Clearing this field removes the whole object at this path (e.g. "no pagination"). */
  clears?: string
  visible?: (value: Record<string, unknown>) => boolean
}

/**
 * Dumb editor for a nested settings object with a help line, an optional example (e.g. from a preset)
 * and, for paths, the resulting URL. Keys it has no field for are kept untouched.
 */
const props = defineProps<{
  modelValue: Record<string, unknown>
  fields: SettingField[]
  example?: Record<string, unknown> | null
  exampleName?: string
  /** Service root the paths are glued to. */
  base?: string
  /** Values for {placeholders} in path previews. */
  vars?: Record<string, string>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>()

const shown = computed(() => props.fields.filter(f => !f.visible || f.visible(props.modelValue)))
// Text being typed that does not parse yet (or would reformat while typing) stays as typed.
const drafts = ref<Record<string, string>>({}), errors = ref<Record<string, string>>({})
let emitted: Record<string, unknown> | null = null
watch(() => props.modelValue, v => { if (v !== emitted) { drafts.value = {}; errors.value = {} } })

function format(f: SettingField, v: unknown): string {
  if (v === undefined || v === null) return ''
  if (f.kind === 'list' || f.kind === 'numbers') return Array.isArray(v) ? v.join(', ') : String(v)
  if (f.kind === 'pairs') return v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('\n') : ''
  if (f.kind === 'json') return JSON.stringify(v, null, 2)
  return String(v)
}
const display = (f: SettingField) => drafts.value[f.path] ?? format(f, getPath(props.modelValue, f.path))

function parse(f: SettingField, text: string): unknown {
  const t = text.trim()
  if (!t) return undefined
  if (f.kind === 'number') { if (!/^\d+$/.test(t)) throw Error('Нужно целое число'); return Number(t) }
  if (f.kind === 'list') return t.split(/[\s,]+/).filter(Boolean)
  if (f.kind === 'numbers') {
    const items = t.split(/[\s,]+/).filter(Boolean)
    if (items.some(i => !/^\d+$/.test(i))) throw Error('Нужны числа через запятую, например 401, 403')
    return items.map(Number)
  }
  if (f.kind === 'pairs') {
    const entries = t.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const at = line.search(/[:=]/)
      if (at <= 0) throw Error(`Строка «${line}»: нужен формат «имя: значение»`)
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    })
    return Object.fromEntries(entries)
  }
  if (f.kind === 'json') { try { return JSON.parse(t) } catch { throw Error('Неверный JSON — проверьте скобки, кавычки и запятые') } }
  if (f.kind === 'path' && /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    let tail = ''
    try { const u = new URL(t); tail = u.pathname + u.search } catch { /* the generic message is enough */ }
    throw Error(`Нужен путь без адреса сервиса${tail ? `: ${tail}` : ', начиная с «/»'}`)
  }
  return text
}
function commit(f: SettingField, value: unknown) {
  emitted = value === undefined && f.clears ? setPath(props.modelValue, f.clears, undefined) : setPath(props.modelValue, f.path, value)
  emit('update:modelValue', emitted)
}
function input(f: SettingField, text: string) {
  drafts.value[f.path] = text
  try { const value = parse(f, text); delete errors.value[f.path]; commit(f, value) }
  catch (e) { errors.value[f.path] = (e as Error).message }
}
function settle(f: SettingField) { if (!errors.value[f.path]) delete drafts.value[f.path] }
function setBool(f: SettingField, checked: boolean) { commit(f, checked || undefined) }

function preview(f: SettingField) {
  const value = getPath(props.modelValue, f.path)
  if (f.kind !== 'path' || typeof value !== 'string' || !value.trim() || !props.base) return ''
  const filled = value.replace(/\{(\w+)\}/g, (m, k: string) => props.vars?.[k] ?? m)
  return props.base + (filled.startsWith('/') ? '' : '/') + filled
}
function exampleOf(f: SettingField) {
  if (!props.example) return ''
  const value = getPath(props.example, f.path)
  if (value === undefined || JSON.stringify(value) === JSON.stringify(getPath(props.modelValue, f.path))) return ''
  return f.kind === 'select' ? f.options?.find(o => o.value === value)?.label ?? String(value) : format(f, value).replace(/\n/g, '; ')
}
</script>

<style scoped>
.settings-fields { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mono :deep(input), .mono :deep(textarea) { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12px; }
.help, .preview, .field-error, .find p { font-size: 11.5px; line-height: 1.5; color: var(--text-faint); overflow-wrap: anywhere; }
.preview { color: var(--text-muted); }
.field-error { color: var(--danger-hover); }
code { padding: 1px 5px; background: var(--bg3); border-radius: 4px; font-size: 11px; color: var(--text-muted); }
.preview code { color: var(--blue-hover); }
.check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); cursor: pointer; }
.find summary { font-size: 11.5px; color: var(--blue-hover); cursor: pointer; width: fit-content; }
.find p { margin-top: 4px; padding: 6px 10px; border-left: 2px solid var(--border-strong); color: var(--text-muted); }
</style>
