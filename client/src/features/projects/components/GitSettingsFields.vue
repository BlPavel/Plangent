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
        small :popup-max-width="260" empty-label="Не задана" placeholder="Не задана" :label="field.label" @update:model-value="set(field.key, $event)"
      />
      <AppInput v-else-if="field.kind === 'branch'" size="sm" :model-value="String(value(field.key) ?? '')" :placeholder="field.placeholder" @update:model-value="set(field.key, $event)" />
      <template v-else-if="field.kind === 'tags'">
        <div class="gs-tags">
          <div class="gs-chips">
            <span v-if="!tags(field.key).length" class="gs-empty">Пока ничего не добавлено</span>
            <AppChip v-for="tag in tags(field.key)" :key="tag" removable :remove-label="'Убрать ' + tag" @remove="removeTag(field.key, tag)">{{ tagLabel(field.key, tag) }}</AppChip>
          </div>
          <!-- People come only from the code host: without its members the button stays, disabled. -->
          <MemberPicker v-if="isPeople(field.key)" :members="freeMembers(field.key)" @pick="set(field.key, [...tags(field.key), $event])" />
          <AppInput
            v-else class="gs-tag-input" size="sm" :placeholder="tags(field.key).length ? 'Добавить…' : field.placeholder"
            @keydown.enter.prevent="addTag(field.key, $event)" @blur="addTag(field.key, $event)"
          />
        </div>
        <AppButton v-if="field.defaults && !tags(field.key).length" variant="link" size="xs" @click="set(field.key, [...field.defaults])">Применить дефолтные: {{ field.defaults.join(', ') }}</AppButton>
      </template>
      <AppTextarea block v-else rows="4" :placeholder="field.placeholder" :model-value="String(value(field.key) ?? '')" @update:model-value="set(field.key, $event)" />

      <small v-if="isPeople(field.key) && (membersNote || !members?.length)" class="gs-hint">{{ membersNote || 'Список людей берётся с хостинга: выберите подключение в «Хостинг кода».' }}</small>
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
type Section = 'branches' | 'mr' | 'workspace-files' | 'workspace-setup' | 'review'
/** `group`: a group has no repository of its own, so its branches and people are chosen per project. */
const props = defineProps<{ modelValue: ProjectGitSettings; inherited: ProjectGitSettings; sources?: Record<string, string>; section: Section; branches?: string[]; members?: Member[]; membersNote?: string; group?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: ProjectGitSettings] }>()
const scenarios = finishScenarioLabels
const DEFAULT_PREFIXES = ['feature', 'fix', 'hotfix']
type Key = keyof ProjectGitSettings
type Field = { key: Key; label: string; kind?: 'tags' | 'boolean' | 'branch'; placeholder?: string; hint?: string; defaults?: string[] }
const sections: Record<Section, Field[]> = {
 'workspace-files': [
  {
    key: 'workspace_copy_files', label: 'Файлы и папки для копирования', kind: 'tags', placeholder: '.env',
    hint: 'Пути и маски от корня проекта; Enter — добавить следующий. Примеры: .env, config/local.json, .claude/skills/мой-скилл. Папка копируется целиком, с вложенным; вложенные файлы задаются масками: packages/*/.env (* — любое имя), apps/**/.env.local (** — любая вложенность), config/*.{json,yml}.\n'
      + 'Не начинайте маску с ** — это обход всего проекта вместе с node_modules; лучше указать папку. Чего нет в основной папке, пропускается без ошибки. Папка .git не копируется; ссылки (symlink) копировать нельзя — рабочее место не подготовится.\n'
      + 'Скиллы и инструкции, созданные в Plangent для проекта или группы, копировать не нужно: Plangent сам раскладывает их в рабочее место. Свои файлы с ними, которых нет в git, добавьте здесь.',
  },
  {
    key: 'workspace_link_dirs', label: 'Папки зависимостей из основной папки', kind: 'tags', placeholder: 'node_modules',
    hint: 'Любая папка из основной папки проекта переносится в рабочее место жёсткими ссылками: за секунды и почти без места на диске. Команда подготовки после этого доставляет только то, что добавила ветка. Например: node_modules, client/node_modules, vendor; без масок. Пусто — ничего не переносится.\n'
      + 'Файлы общие с основной папкой: всё, что перезапишет файл на месте, изменит его и там. Подходит для папок, где менеджер пакетов заменяет пакеты целиком (node_modules, composer vendor). Не подходит для того, что пересобирается или правится на месте: Python .venv (его pip ставит пакеты в основной venv), bin/obj в .NET, target в Rust. Не правьте эти файлы вручную в рабочем месте.\n'
      + 'Нативные модули Node (*.node, build/Release), файлы в корне папки (служебные файлы менеджера пакетов) и кэши .cache и .vite копируются отдельно. Ссылки возможны, только если рабочие места на том же диске, что и проект; иначе файлы копируются, это видно в логе подготовки.',
  },
 ],
 'workspace-setup': [
  {
    key: 'workspace_setup_command', label: 'Команда подготовки', placeholder: 'npm install',
    hint: 'Выполняется один раз в новом рабочем месте, после копирования файлов: так ставятся зависимости и собирается то, что не лежит в git. Например: npm install или pnpm i && pnpm build. Запускается в оболочке из папки рабочего места, с переменными окружения проекта; вывод сохраняется в логе рабочего места. Агент этим не занимается.\n'
      + 'Пусто — ничего не запускать. Если команда завершилась ошибкой или шла дольше 10 минут, рабочее место помечается неготовым. Действует на рабочие места, созданные после сохранения.',
  },
  {
    key: 'workspace_ports', label: 'Порты', kind: 'tags', placeholder: 'PORT=3001',
    hint: 'ПЕРЕМЕННАЯ=порт, по одной на приложение: PORT=3001, VITE_PORT=5173. В рабочем месте №1 порты +10, в №2 +20. Приложение должно читать порт из этой переменной.',
  },
 ],
 review: [
  { key: 'auto_review', label: 'Автоматически ревьюить поручения', kind: 'boolean', hint: 'Когда агент впервые выполнил поручение, Plangent один раз запускает ревью его изменений агентом для ревью; дописки агенту после этого ревью не запускают. Выключено по умолчанию; это начальное значение для новых поручений, при создании его можно переключить. Ручной запуск ревью доступен всегда.' },
 ],
 branches: [
  { key: 'branch_prefixes', label: 'Префиксы веток', kind: 'tags', placeholder: 'feature', defaults: DEFAULT_PREFIXES, hint: 'Доступны при создании ветки: feature/ABC-1. Enter — добавить, первый подставляется по умолчанию.' },
  { key: 'base_branch', label: 'Базовая ветка', kind: 'branch', placeholder: 'main', hint: 'Ветки задач создаются от неё, и в неё по умолчанию направляется МР.' },
 ],
 mr: [
  { key: 'finish_scenario', label: 'Сценарий завершения работы' },
  { key: 'mr_remove_branch', label: 'Удалять исходную ветку после слияния', kind: 'boolean' },
  { key: 'mr_squash', label: 'Объединять коммиты при слиянии (squash)', kind: 'boolean' },
  { key: 'mr_assignees', label: 'Исполнители по умолчанию', kind: 'tags', hint: 'Назначаются на МР при создании (Assignees).' },
  { key: 'mr_reviewers', label: 'Ревьюеры по умолчанию', kind: 'tags' },
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
.gs-hint { font-size: var(--fs-xs); color: var(--text-faint); overflow-wrap: anywhere; white-space: pre-line; }
.gs-tags { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.gs-empty { font-size: var(--fs-sm); color: var(--text-faint); }
.gs-tag-input { width: 280px; max-width: 100%; }
/* A row is always reserved, so the first chip does not push the input down. */
.gs-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: var(--size-sm); }
</style>
