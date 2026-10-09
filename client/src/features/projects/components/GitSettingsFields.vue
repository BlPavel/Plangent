<template>
  <details class="git-settings">
    <summary>Git-настройки <span class="gs-count">{{ ownCount ? 'задано здесь: ' + ownCount : 'всё унаследовано' }}</span></summary>
    <section v-for="section in sections" :key="section.title" class="gs-section">
      <h4>{{ section.title }}</h4>
      <div v-for="field in section.fields" :key="field.key" class="setting" :class="{ own: has(field.key) }">
        <div class="gs-head">
          <span class="gs-label">{{ field.label }}</span>
          <span class="gs-source">{{ has(field.key) ? 'задано здесь' : sources?.[field.key] === 'group' ? 'из группы' : 'по умолчанию' }}</span>
          <span class="gs-spacer" />
          <button v-if="has(field.key)" type="button" class="gs-link" @click="toggle(field.key, false)">Сбросить к {{ sources?.[field.key] === 'group' ? 'значению группы' : 'значению по умолчанию' }}</button>
          <button v-else type="button" class="gs-link" :disabled="inherited[field.key] === undefined" @click="toggle(field.key, true)">Переопределить</button>
        </div>
        <template v-if="has(field.key)">
          <select v-if="field.key === 'finish_scenario'" class="control control-sm" :value="modelValue[field.key]" @change="set(field.key, ($event.target as HTMLSelectElement).value)"><option v-for="(label, value) in scenarios" :key="value" :value="value">{{ label }}</option></select>
          <label v-else-if="field.kind === 'boolean'" class="gs-check"><input type="checkbox" :checked="Boolean(modelValue[field.key])" @change="set(field.key, ($event.target as HTMLInputElement).checked)" /> Да</label>
          <input v-else-if="field.kind === 'line'" class="control control-sm" :value="String(modelValue[field.key] ?? '')" :placeholder="field.placeholder" @input="set(field.key, ($event.target as HTMLInputElement).value)" />
          <textarea v-else class="control" rows="3" :placeholder="field.placeholder" :value="Array.isArray(modelValue[field.key]) ? (modelValue[field.key] as string[]).join('\n') : String(modelValue[field.key] ?? '')" @input="set(field.key, field.kind === 'list' ? ($event.target as HTMLTextAreaElement).value.split('\n').filter(Boolean) : ($event.target as HTMLTextAreaElement).value)" />
        </template>
        <div v-else class="gs-value">{{ display(field.key) }}</div>
        <small v-if="field.key === 'branch_template'" class="gs-hint">{key} — ключ задачи, {slug} — название. Пример для BIL-42 «limits»: <code>{{ preview }}</code></small>
      </div>
    </section>
  </details>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectGitSettings } from '@core/models'
const props = defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; sources?: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const scenarios = { nothing: 'Ничего', commits: 'Только коммиты', push: 'Коммиты и push', full: 'Полный цикл' }
type Key = keyof ProjectGitSettings
type Field = { key: Key; label: string; kind?: 'list' | 'boolean' | 'line'; placeholder?: string }
const sections: { title: string; fields: Field[] }[] = [
 { title: 'Коммиты', fields: [
  { key: 'commit_instructions', label: 'Правила коммитов для агента', placeholder: 'Заголовок: КЛЮЧ-123 Кратко, что сделано' },
  { key: 'commit_pattern', label: 'Формат сообщения (regex)', kind: 'line', placeholder: '^[A-Z]+-\\d+ .+' },
  { key: 'forbidden_patterns', label: 'Запрещённые фразы (regex, по одной на строку)', kind: 'list' },
  { key: 'include_description', label: 'Описание в коммите', kind: 'boolean' },
 ] },
 { title: 'Ветки и завершение работ', fields: [
  { key: 'finish_scenario', label: 'Сценарий завершения работы' },
  { key: 'branch_template', label: 'Шаблон имени ветки', kind: 'line', placeholder: 'feature/{key}-{slug}' },
  { key: 'base_branch', label: 'Базовая ветка по умолчанию', kind: 'line', placeholder: 'main' },
 ] },
 { title: 'Merge request', fields: [
  { key: 'mr_target_branch', label: 'Целевая ветка МР', kind: 'line', placeholder: 'main' },
  { key: 'mr_description_template', label: 'Шаблон описания МР' },
  { key: 'mr_remove_branch', label: 'Удалять исходную ветку', kind: 'boolean' },
  { key: 'mr_squash', label: 'Squash', kind: 'boolean' },
  { key: 'mr_reviewers', label: 'Ревьюеры МР (по одному на строку)', kind: 'list' },
  { key: 'mr_labels', label: 'Метки МР (по одной на строку)', kind: 'list' },
 ] },
]
const has = (key: Key) => Object.hasOwn(props.modelValue, key)
const ownCount = computed(() => sections.flatMap(s => s.fields).filter(f => has(f.key)).length)
const effective = (key: Key) => has(key) ? props.modelValue[key] : props.inherited[key]
const preview = computed(() => String(effective('branch_template') ?? '').replaceAll('{key}', 'BIL-42').replaceAll('{slug}', 'limits'))
function display(key: Key) { const value = effective(key); return key === 'finish_scenario' ? scenarios[value as keyof typeof scenarios] : typeof value === 'boolean' ? value ? 'Да' : 'Нет' : Array.isArray(value) ? value.join('; ') || 'Пусто' : String(value || 'Пусто') }
function set(key: Key, value: unknown) { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
function toggle(key: Key, enabled: boolean) { const value = { ...props.modelValue }; if (enabled && props.inherited[key] !== undefined) Object.assign(value, { [key]: props.inherited[key] }); else delete value[key]; emit('update:modelValue', value) }
</script>
<style scoped>
.git-settings { border: 1px solid var(--border); border-radius: var(--radius-sm); }
summary { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--text); cursor: pointer; }
.gs-count { margin-left: 6px; font-weight: 400; color: var(--text-faint); }
.gs-section { display: flex; flex-direction: column; gap: 10px; padding: 8px 12px 12px; border-top: 1px solid var(--border); }
h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.setting { display: flex; flex-direction: column; gap: 4px; }
.gs-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.gs-label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.setting.own .gs-label { color: var(--text); }
.gs-source { font-size: 11px; color: var(--text-faint); }
.setting.own .gs-source { color: var(--blue-hover); }
.gs-spacer { flex: 1; }
.gs-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.gs-link:disabled { color: var(--text-faint); cursor: default; }
.gs-value { padding: 4px 8px; font-size: 12px; color: var(--text-muted); white-space: pre-wrap; overflow-wrap: anywhere; border-left: 2px solid var(--border-strong); max-height: 72px; overflow: auto; }
.control { width: 100%; }
textarea.control { height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.gs-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.gs-check input { margin: 0; accent-color: var(--blue); }
.gs-hint { font-size: 11px; color: var(--text-faint); overflow-wrap: anywhere; }
</style>
