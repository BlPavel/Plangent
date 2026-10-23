<template>
  <div class="git-settings">
    <div v-for="field in fields" :key="field.key" class="setting">
      <div class="gs-head">
        <label v-if="field.kind === 'boolean'" class="gs-check"><input type="checkbox" :checked="Boolean(value(field.key))" @change="set(field.key, ($event.target as HTMLInputElement).checked)" /> {{ field.label }}</label>
        <span v-else class="gs-label">{{ field.label }}</span>
        <!-- Only a value changed here can be reset; an inherited one is just shown. -->
        <button v-if="changed(field.key)" type="button" class="gs-link" :title="'Вернуть ' + (sources?.[field.key] === 'group' ? 'значение группы' : sources?.[field.key] === 'global' ? 'глобальное значение' : 'значение по умолчанию')" @click="reset(field.key)">сбросить</button>
      </div>

      <PlainSelect v-if="field.key === 'finish_scenario'" :model-value="String(value(field.key) ?? '')" :options="Object.entries(scenarios).map(([option, label]) => ({ value: option, label }))" small :label="field.label" @update:model-value="set(field.key, $event)" />
      <template v-else-if="field.kind === 'boolean'" />
      <BranchSelect
        v-else-if="field.kind === 'branch' && branches?.length" :model-value="String(value(field.key) ?? '')" :options="branchOptions(String(value(field.key) ?? '')).map(name => ({ value: name, label: name }))"
        small empty-label="Не задана" placeholder="Не задана" :label="field.label" @update:model-value="set(field.key, $event)"
      />
      <input v-else-if="field.kind === 'branch'" class="control control-sm" :value="String(value(field.key) ?? '')" :placeholder="field.placeholder" @input="set(field.key, ($event.target as HTMLInputElement).value)" />
      <template v-else-if="field.kind === 'tags'">
        <div class="gs-tags">
          <span v-for="tag in tags(field.key)" :key="tag" class="gs-tag">{{ tagLabel(field.key, tag) }}<button type="button" class="gs-x" :aria-label="'Убрать ' + tag" @click="removeTag(field.key, tag)">×</button></span>
          <input
            v-if="!(isPeople(field.key) && members?.length)" class="gs-tag-input" :placeholder="tags(field.key).length ? 'Добавить…' : field.placeholder"
            @keydown.enter.prevent="addTag(field.key, $event)" @blur="addTag(field.key, $event)"
          />
          <MemberPicker v-else :members="freeMembers(field.key)" @pick="set(field.key, [...tags(field.key), $event])" />
        </div>
        <button v-if="field.defaults && !tags(field.key).length" type="button" class="gs-link gs-apply" @click="set(field.key, [...field.defaults])">Применить дефолтные: {{ field.defaults.join(', ') }}</button>
      </template>
      <textarea v-else class="control" rows="4" :placeholder="field.placeholder" :value="String(value(field.key) ?? '')" @input="set(field.key, ($event.target as HTMLTextAreaElement).value)" />

      <small v-if="isPeople(field.key) && membersNote" class="gs-hint">{{ membersNote }}</small>
      <small v-if="field.hint" class="gs-hint">{{ field.hint }}</small>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectGitSettings } from '@core/models'
import MemberPicker from '@shared/ui/MemberPicker.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import { finishScenarioLabels } from '@shared/utils/finish-scenarios'
type Member = { value: string; login: string; name: string }
const props = defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; sources?: Record<string, string>; section: 'branches' | 'mr'; branches?: string[]; members?: Member[]; membersNote?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const scenarios = finishScenarioLabels
const DEFAULT_PREFIXES = ['feature', 'fix', 'hotfix']
type Key = keyof ProjectGitSettings
type Field = { key: Key; label: string; kind?: 'tags' | 'boolean' | 'branch'; placeholder?: string; hint?: string; defaults?: string[] }
const sections: Record<'branches' | 'mr', Field[]> = {
 branches: [
  { key: 'branch_prefixes', label: 'Префиксы веток', kind: 'tags', placeholder: 'feature', defaults: DEFAULT_PREFIXES, hint: 'Доступны при создании ветки: feature/ABC-1. Enter — добавить, первый подставляется по умолчанию.' },
  { key: 'base_branch', label: 'Базовая ветка', kind: 'branch', placeholder: 'main', hint: 'Ветки задач создаются от неё, и в неё по умолчанию направляется МР.' },
 ],
 mr: [
  { key: 'finish_scenario', label: 'Сценарий завершения работы' },
  { key: 'mr_description_prompt', label: 'Как описывать МР', placeholder: 'Коротко: что и зачем изменено. Без списка файлов. Упомяни миграции и breaking changes.', hint: 'Инструкция для агента, который пишет описание. Пусто — агент решает сам.' },
  { key: 'mr_remove_branch', label: 'Удалять исходную ветку после слияния', kind: 'boolean' },
  { key: 'mr_squash', label: 'Объединять коммиты при слиянии (squash)', kind: 'boolean' },
  { key: 'mr_assignees', label: 'Исполнители по умолчанию', kind: 'tags', placeholder: 'логин или ID', hint: 'Назначаются на МР при создании (Assignees).' },
  { key: 'mr_reviewers', label: 'Ревьюеры по умолчанию', kind: 'tags', placeholder: 'логин или ID' },
 ],
}
const fields = computed(() => sections[props.section])
const has = (key: Key) => Object.hasOwn(props.modelValue, key)
// What applies now: the own value, else the group's or the built-in one.
const value = (key: Key) => has(key) ? props.modelValue[key] : props.inherited[key]
const changed = (key: Key) => has(key) && JSON.stringify(props.modelValue[key]) !== JSON.stringify(props.inherited[key])
const tags = (key: Key) => (value(key) as string[] | undefined) ?? []
/** Reviewers and assignees are picked from the same people the code host knows. */
const isPeople = (key: Key) => key === 'mr_reviewers' || key === 'mr_assignees'
const freeMembers = (key: Key) => (props.members ?? []).filter(m => !tags(key).includes(m.value))
const tagLabel = (key: Key, tag: string) => isPeople(key) ? props.members?.find(m => m.value === tag)?.name ?? tag : tag
// A stored branch that is not in the list (not fetched yet) stays selectable.
const branchOptions = (current: string) => current && !props.branches?.includes(current) ? [current, ...props.branches!] : props.branches!
function set(key: Key, next: unknown) { emit('update:modelValue', { ...props.modelValue, [key]: next }) }
function reset(key: Key) { const next = { ...props.modelValue }; delete next[key]; emit('update:modelValue', next) }
function addTag(key: Key, event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  const tag = key === 'branch_prefixes' ? raw.replace(/^\/+|\/+$/g, '') : raw
  input.value = ''
  if (tag && !tags(key).includes(tag)) set(key, [...tags(key), tag])
}
function removeTag(key: Key, tag: string) { set(key, tags(key).filter(item => item !== tag)) }
</script>
<style scoped>
.git-settings { display: flex; flex-direction: column; gap: 18px; }
.setting { display: flex; flex-direction: column; gap: 4px; }
.gs-head { display: flex; align-items: center; gap: 8px; min-height: 18px; }
.gs-label { font-size: 12.5px; font-weight: 500; color: var(--text); }
.gs-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--text-faint); background: none; border: none; cursor: pointer; }
.gs-link:hover { color: var(--blue-hover); }
.gs-apply { align-self: flex-start; }
.control { width: 100%; }
textarea.control { height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.gs-check { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); cursor: pointer; }
.gs-check input { margin: 0; accent-color: var(--blue); }
.gs-hint { font-size: 11px; color: var(--text-faint); overflow-wrap: anywhere; }
.gs-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 6px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.gs-tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; font-size: 12px; background: var(--blue-soft); color: var(--blue-hover); border-radius: var(--radius-pill); }
.gs-x { padding: 0 3px; font: inherit; line-height: 1; color: inherit; background: none; border: none; cursor: pointer; }
.gs-tag-input { flex: 1; min-width: 90px; padding: 2px 4px; font: inherit; font-size: 12px; color: var(--text); background: none; border: none; }
.gs-tag-input:focus { outline: none; }
</style>
