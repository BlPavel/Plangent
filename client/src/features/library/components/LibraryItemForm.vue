<template>
  <div class="lif">
    <!-- Type selector — drives the rest of the form -->
    <div class="form-field">
      <label>Тип</label>
      <AppTabs :model-value="form.type" :items="availableTypes.map(t => ({ ...t, disabled: isTypeDisabled(t.value), title: t.value === 'main' && mainBlocked ? 'Главный файл уже создан' : '' }))" label="Тип" @update:model-value="selectType($event as LibraryItemType)" />
      <span class="hint">{{ typeHint }}</span>
    </div>

    <!-- Main file already exists notice -->
    <div v-if="form.type === 'main' && mainBlocked && !isEdit" class="notice">
      Главный файл для этого уровня уже существует — можно создать только один.
      Закройте это окно и измените существующий.
    </div>

    <!-- Title — name in the list / source for the file name (skills & commands) -->
    <div v-if="form.type !== 'main'" class="form-field" :class="{ invalid: err.title }">
      <label>Название <span class="req">*</span></label>
      <AppInput v-model="form.title" :invalid="!!err.title" :placeholder="form.type === 'command' ? 'code_review' : isReviewSkill ? 'Архитектура' : 'db_migrations'" @input="clearErr('title')" />
      <span v-if="form.type === 'command' && form.title.trim()" class="hint">Будет вызываться как <code>/{{ slugPreview }}</code></span>
      <span v-else-if="form.type === 'review-skill'" class="hint">Так скилл называется в выборе перед разбором МР.</span>
      <span v-else-if="form.type === 'plan-review-skill'" class="hint">Так скилл называется в выборе перед ревью плана.</span>
      <span v-else-if="isReviewSkill" class="hint">Так скилл называется в выборе перед ревью соответствующего материала.</span>
      <span v-else class="hint">Только латиница, цифры и <code>_</code> (например <code>db_migrations</code>). Так будет называться файл на диске.</span>
      <span v-if="err.title" class="error">{{ err.title }}</span>
    </div>

    <!-- Description — optional; empty means "apply always" (goes into frontmatter) -->
    <div v-if="form.type !== 'main'" class="form-field">
      <label>{{ isReviewSkill ? 'Описание' : 'Когда применять' }}</label>
      <AppInput v-model="form.description" :placeholder="descPlaceholder" />
      <span class="hint">{{ descHint }}</span>
    </div>

    <!-- Manual-only invocation — only skills can be downgraded to manual -->
    <div v-if="form.type === 'skill'" class="form-field">
      <AppCheckbox v-model="form.disableModelInvocation">Только ручной вызов (как команда)</AppCheckbox>
      <span class="hint">Агент не подключит скилл сам — его нужно вызвать вручную через /slash.</span>
    </div>

    <!-- Agent filter — pick from agents created in настройках -->
    <div v-if="!form.type.endsWith('-template') && !isReviewSkill" class="form-field">
      <label>Для каких агентов</label>
      <div v-if="agents.length" class="agent-picker">
        <AppButton
          v-for="a in agents"
          :key="a.id"
          variant="subtle" size="sm" :pressed="form.agent_filter.includes(a.id)"
          @click="toggleAgent(a.id)"
        >{{ a.name }}</AppButton>
      </div>
      <span v-else class="hint">Агентов пока нет. Создайте их в Настройках → Агенты.</span>
      <span class="hint">{{ form.agent_filter.length ? 'Применится только к выбранным.' : 'Ничего не выбрано — применится ко всем агентам.' }}</span>
    </div>

    <!-- Content -->
    <div class="form-field" :class="{ invalid: err.content }">
      <label>{{ contentLabel }} <span class="req">*</span></label>
      <AppTextarea mono block v-model="form.content" :invalid="!!err.content" rows="14" :placeholder="contentPlaceholder" @input="clearErr('content')" />
      <span v-if="err.content" class="error">{{ err.content }}</span>
    </div>

    <div v-if="form.type === 'plan-template'" class="form-field">
      <label>Протокол Plangent</label>
      <AppTextarea mono block :model-value="lockedPlanProtocol" rows="9" readonly />
      <span class="hint">Это контракт движка Plangent. Структуру плана меняйте выше. Шаги должны оставаться чекбоксами <code>- [ ]</code>, иначе Plangent не увидит их для очереди выполнения.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { AppButton, AppCheckbox, AppTabs } from '@shared/ui'
import { computed, reactive } from 'vue'
import type { Agent, LibraryItemType } from '@contracts'

export interface LibraryFormModel {
  type: LibraryItemType
  slug: string
  title: string
  description: string
  agent_filter: string[]
  disableModelInvocation: boolean
  content: string
}

const props = defineProps<{
  form: LibraryFormModel
  agents: Agent[]
  isEdit: boolean
  /** id главного файла, уже существующего в текущем scope (или null) */
  existingMainId: string | null
  allowedTypes?: LibraryItemType[]
  defaultPlanTemplate?: string
  lockedPlanProtocol?: string
}>()
const { form } = props
const isReviewSkill = computed(() => form.type === 'review-skill' || form.type.endsWith('-review-skill'))

const TYPES: { value: LibraryItemType; label: string }[] = [
  { value: 'skill', label: 'Скилл' },
  { value: 'command', label: 'Команда' },
  { value: 'main', label: 'Главный файл' },
  { value: 'plan-template', label: 'Шаблон плана' },
  { value: 'review-skill', label: 'Скилл ревью' },
  { value: 'architecture-template', label: 'Как писать архитектуру' },
  { value: 'qa-template', label: 'Как писать QA' },
  { value: 'architecture-review-skill', label: 'Ревью архитектуры' },
  { value: 'qa-review-skill', label: 'Ревью QA' },
  { value: 'plan-review-skill', label: 'Ревью плана' },
]
const availableTypes = computed(() => TYPES.filter(t => !props.allowedTypes || props.allowedTypes.includes(t.value)))

// Главный файл уже есть и мы не редактируем именно его
const mainBlocked = computed(() => props.existingMainId !== null)

function isTypeDisabled(t: LibraryItemType): boolean {
  if (props.allowedTypes && !props.allowedTypes.includes(t)) return true
  if (props.isEdit) return form.type !== t
  if (t === 'main' && mainBlocked.value) return true
  return false
}

const typeHint = computed(() => ({
  'code-fixer-instruction': 'Инструкция агента доработки по замечаниям ревью.',
  'commit-rules': 'Правила написания сообщений коммитов для агентов.',
  'instruction-guide': 'Правила написания скиллов, главного файла и команд. Используется ближайший уровень: проект, группа, глобальный.',
  skill: 'Инструкция, которую агент подключает сам по релевантности (по полю «Когда применять»).',
  command: 'Готовая инструкция, вызывается вручную как /команда.',
  main: 'Главные инструкции — всегда в контексте агента, у каждого агента раскладываются в свой главный файл. Может быть только один.',
  'plan-template': 'Структура плана для режима планирования. Протокол шагов добавляется ниже и не редактируется.',
  'review-skill': 'Что агенту важно в ревью МР этого проекта и что пропускать. Выбирается перед разбором во вкладке «Ревью»; формат сводки и замечаний задаёт Plangent.',
  'plan-review-skill': 'Ваши требования к плану в этом проекте: архитектура, границы модулей, соглашения. Общие проверки (противоречия, порядок, покрытие) уже задаёт глобальная инструкция. Выбирается перед запуском ревью плана; формат замечаний задаёт Plangent. В папки агентов не синхронизируется.',
  'architecture-template': 'Как писать архитектуру: применяется только в соответствующем разделе подготовки задачи.',
  'qa-template': 'Как писать QA: применяется только в соответствующем разделе подготовки задачи.',
  'architecture-review-skill': 'Ревью архитектуры: применяется только в соответствующем разделе подготовки задачи.',
  'qa-review-skill': 'Ревью QA: применяется только в соответствующем разделе подготовки задачи.',
  'architecture-review-instruction': 'Общая инструкция из глобальных настроек.',
  'qa-review-instruction': 'Общая инструкция из глобальных настроек.',
  'interview-instruction': 'Общая инструкция из глобальных настроек.',
  'plan-review-instruction': 'Что проверять в плане. Редактируется во вкладке «Ревью плана».',
  'mr-review-instruction': 'Что проверять в МР. Редактируется во вкладке «Ревью МР».',
}[form.type]))

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}
const slugPreview = computed(() => slugify(form.title) || 'name')

const descPlaceholder = computed(() => form.type === 'command'
  ? 'Что делает команда (необязательно)'
  : isReviewSkill.value
    ? 'Например: границы модулей и контракты API, без стиля'
  : form.type === 'plan-template'
    ? 'Например: дефолтный шаблон планирования'
  : 'Например: при работе с миграциями БД (необязательно)')
const descHint = computed(() => form.type === 'command'
  ? 'Короткая подсказка для списка команд. Можно оставить пустым.'
  : isReviewSkill.value
    ? 'Одна строка для списка. Можно оставить пустым.'
  : form.type === 'plan-template'
    ? 'Используется только в списке библиотеки.'
  : 'Если оставить пустым — скилл применяется всегда. Если заполнить — агент подключает его по релевантности. Попадает во frontmatter (description).')

const contentLabel = computed(() => form.type === 'main' ? 'Содержимое файла' : form.type === 'plan-template' ? 'Тело шаблона плана' : 'Инструкция (markdown)')
const contentPlaceholder = computed(() => form.type === 'main'
  ? '# Правила проекта\n\n...'
  : form.type === 'plan-template'
    ? props.defaultPlanTemplate || '# [Название задачи]\n\n## Шаги\n\n- [ ] Первый шаг'
  : '# Инструкция\n\n...')

// --- Validation ---
const err = reactive<Record<string, string>>({})
function clearErr(field: string) { if (err[field]) delete err[field] }

function validate(): boolean {
  Object.keys(err).forEach(k => delete err[k])
  if (isReviewSkill.value) {
    if (!form.title.trim()) err.title = 'Укажите название'
  } else if (form.type !== 'main') {
    const title = form.title.trim()
    if (!title) err.title = 'Укажите название'
    else if (!/^[a-zA-Z0-9_]+$/.test(title)) {
      err.title = 'Только латиница, цифры и _ — без пробелов, кириллицы и других символов'
    }
  }
  if (!form.content.trim()) err.content = 'Контент не может быть пустым'
  return Object.keys(err).length === 0
}

defineExpose({ validate })

function selectType(t: LibraryItemType) {
  if (isTypeDisabled(t) || form.type === t) return
  // Меняем тип → чистим заполненные поля и ошибки, чтобы форма соответствовала новому типу
  form.type = t
  form.slug = ''
  form.title = ''
  form.description = ''
  form.agent_filter = []
  form.disableModelInvocation = false
  form.content = t === 'plan-template' ? (props.defaultPlanTemplate ?? '') : ''
  Object.keys(err).forEach(k => delete err[k])
}

function toggleAgent(id: string) {
  const i = form.agent_filter.indexOf(id)
  if (i === -1) form.agent_filter.push(id)
  else form.agent_filter.splice(i, 1)
}
</script>

<style scoped>
.lif { display: flex; flex-direction: column; gap: 14px; }
.form-field { display: flex; flex-direction: column; gap: 5px; }
label { font-size: var(--fs-sm); color: var(--text-muted); }
.req { color: var(--danger); }
.hint { font-size: var(--fs-xs); color: var(--text-muted); opacity: 0.75; line-height: 1.4; }
.hint code { font-family: var(--font-mono); background: var(--bg3); padding: 0 4px; border-radius: var(--radius-3); }
.error { font-size: var(--fs-xs); color: var(--danger); }
.checkbox-label { flex-direction: row; align-items: center; gap: 6px; cursor: pointer; font-size: var(--fs-md); color: var(--text); }

.notice {
  font-size: var(--fs-sm); color: var(--text); background: var(--bg3);
  border: 1px solid var(--border); border-left: 3px solid var(--danger);
  border-radius: var(--radius); padding: 8px 12px; line-height: 1.4;
}

.agent-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.template-toolbar { display: flex; justify-content: flex-end; margin-bottom: 2px; }
</style>
