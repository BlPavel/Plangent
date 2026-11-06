<template>
  <div class="git-settings">
    <div v-for="field in fields" :key="field.key" class="setting">
      <div class="gs-head">
        <AppCheckbox v-if="field.kind === 'boolean'" :model-value="Boolean(value(field.key))" @update:model-value="set(field.key, $event)">{{ field.label }}</AppCheckbox>
        <span v-else class="gs-label">{{ field.label }}</span>
        <!-- Only a value changed here can be reset; an inherited one is just shown. -->
        <AppButton v-if="changed(field.key)" variant="link" size="xs" :title="'Вернуть ' + (sources?.[field.key] === 'group' ? 'значение группы' : sources?.[field.key] === 'global' ? 'глобальное значение' : 'значение по умолчанию')" @click="reset(field.key)">сбросить</AppButton>
      </div>

      <AppSelect v-if="field.key === 'finish_scenario'" :model-value="String(value(field.key) ?? '')" :options="Object.entries(scenarios).map(([option, label]) => ({ value: option, label }))" small :label="field.label" @update:model-value="set(field.key, $event)" />
      <template v-else-if="field.kind === 'boolean'" />
      <BranchSelect
        v-else-if="field.kind === 'branch' && branches?.length" :model-value="String(value(field.key) ?? '')" :options="branchOptions(String(value(field.key) ?? '')).map(name => ({ value: name, label: name }))"
        small empty-label="Не задана" placeholder="Не задана" :label="field.label" @update:model-value="set(field.key, $event)"
      />
      <AppInput v-else-if="field.kind === 'branch'" size="sm" :model-value="String(value(field.key) ?? '')" :placeholder="field.placeholder" @update:model-value="set(field.key, $event)" />
      <template v-else-if="field.kind === 'tags'">
        <div class="gs-tags">
          <AppChip v-for="tag in tags(field.key)" :key="tag" removable :remove-label="'Убрать ' + tag" @remove="removeTag(field.key, tag)">{{ tagLabel(field.key, tag) }}</AppChip>
          <AppInput
            v-if="!(isPeople(field.key) && members?.length)" class="gs-tag-input" :placeholder="tags(field.key).length ? 'Добавить…' : field.placeholder"
            @keydown.enter.prevent="addTag(field.key, $event)" @blur="addTag(field.key, $event)"
          />
          <MemberPicker v-else :members="freeMembers(field.key)" @pick="set(field.key, [...tags(field.key), $event])" />
        </div>
        <AppButton v-if="field.defaults && !tags(field.key).length" variant="link" size="xs" @click="set(field.key, [...field.defaults])">Применить дефолтные: {{ field.defaults.join(', ') }}</AppButton>
      </template>
      <AppTextarea block v-else rows="4" :placeholder="field.placeholder" :model-value="String(value(field.key) ?? '')" @update:model-value="set(field.key, $event)" />

      <small v-if="isPeople(field.key) && membersNote" class="gs-hint">{{ membersNote }}</small>
      <small v-if="field.hint" class="gs-hint">{{ field.hint }}</small>
    </div>
  </div>
</template>
<script setup lang="ts">
import { AppButton, AppCheckbox, AppChip, AppInput, AppTextarea } from '@shared/ui'
import { computed } from 'vue'
import type { ProjectGitSettings } from '@contracts'
import MemberPicker from '@shared/ui/MemberPicker.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import { finishScenarioLabels } from '@features/finish'
type Member = { value: string; login: string; name: string }
/** `group`: a group has no repository of its own, so its branches and people are chosen per project. */
const props = defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; sources?: Record<string, string>; section: 'branches' | 'mr' | 'workspace'; branches?: string[]; members?: Member[]; membersNote?: string; group?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const scenarios = finishScenarioLabels
const DEFAULT_PREFIXES = ['feature', 'fix', 'hotfix']
type Key = keyof ProjectGitSettings
type Field = { key: Key; label: string; kind?: 'tags' | 'boolean' | 'branch'; placeholder?: string; hint?: string; defaults?: string[] }
const sections: Record<'branches' | 'mr' | 'workspace', Field[]> = {
 workspace: [
  { key: 'workspace_copy_files', label: 'Файлы для копирования', kind: 'tags', placeholder: '.env', hint: 'Путь или маска от корня проекта, например .env. Копируется из основной папки в каждое новое рабочее место: в git этих файлов нет.' },
  { key: 'workspace_setup_command', label: 'Команда подготовки', placeholder: 'npm install', hint: 'Plangent запускает её в новом рабочем месте после копирования; агент этим не занимается. Пусто — ничего не запускать. Действует на рабочие места, созданные после сохранения.' },
  { key: 'auto_review', label: 'Ревью агентом: автоматически', kind: 'boolean', hint: 'Выключено по умолчанию. Можно переключить для отдельной работы; ручной запуск ревью доступен всегда.' },
 ],
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
const PROJECT_ONLY: Key[] = ['base_branch', 'mr_assignees', 'mr_reviewers']
const fields = computed(() => sections[props.section].filter(field => !props.group || !PROJECT_ONLY.includes(field.key)))
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
.gs-label { font-size: var(--fs-md); font-weight: 500; color: var(--text); }
.gs-hint { font-size: var(--fs-xs); color: var(--text-faint); overflow-wrap: anywhere; }
.gs-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 6px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.gs-tag-input { flex: 1; }
</style>
