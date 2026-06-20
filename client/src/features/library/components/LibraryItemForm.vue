<template>
  <div class="lif">
    <!-- Type selector — drives the rest of the form -->
    <div class="form-field">
      <label>Тип</label>
      <div class="type-tabs">
        <button
          v-for="t in availableTypes"
          :key="t.value"
          type="button"
          class="type-tab"
          :class="{ active: form.type === t.value }"
          :disabled="isTypeDisabled(t.value)"
          :title="t.value === 'main' && mainBlocked ? 'Главный файл уже создан' : ''"
          @click="selectType(t.value)"
        >{{ t.label }}</button>
      </div>
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
      <input v-model="form.title" :placeholder="form.type === 'command' ? 'code_review' : 'db_migrations'" @input="clearErr('title')" />
      <span v-if="form.type === 'command' && form.title.trim()" class="hint">Будет вызываться как <code>/{{ slugPreview }}</code></span>
      <span v-else class="hint">Только латиница, цифры и <code>_</code> (например <code>db_migrations</code>). Так будет называться файл на диске.</span>
      <span v-if="err.title" class="error">{{ err.title }}</span>
    </div>

    <!-- Description — optional; empty means "apply always" (goes into frontmatter) -->
    <div v-if="form.type !== 'main'" class="form-field">
      <label>Когда применять</label>
      <input v-model="form.description" :placeholder="descPlaceholder" />
      <span class="hint">{{ descHint }}</span>
    </div>

    <!-- Manual-only invocation — only skills can be downgraded to manual -->
    <div v-if="form.type === 'skill'" class="form-field">
      <label class="checkbox-label">
        <input type="checkbox" v-model="form.disableModelInvocation" />
        Только ручной вызов (как команда)
      </label>
      <span class="hint">Агент не подключит скилл сам — его нужно вызвать вручную через /slash.</span>
    </div>

    <!-- Agent filter — pick from agents created in настройках -->
    <div v-if="form.type !== 'plan-template'" class="form-field">
      <label>Для каких агентов</label>
      <div v-if="agents.length" class="agent-picker">
        <button
          v-for="a in agents"
          :key="a.id"
          type="button"
          class="agent-chip"
          :class="{ active: form.agent_filter.includes(a.id) }"
          @click="toggleAgent(a.id)"
        >{{ a.name }}</button>
      </div>
      <span v-else class="hint">Агентов пока нет. Создайте их в Настройках → Агенты.</span>
      <span class="hint">{{ form.agent_filter.length ? 'Применится только к выбранным.' : 'Ничего не выбрано — применится ко всем агентам.' }}</span>
    </div>

    <!-- Content -->
    <div class="form-field" :class="{ invalid: err.content }">
      <label>{{ contentLabel }} <span class="req">*</span></label>
      <div v-if="form.type === 'plan-template'" class="template-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" @click="$emit('copySystemDefault')">Скопировать системный дефолт</button>
      </div>
      <textarea v-model="form.content" class="content-editor" rows="14" :placeholder="contentPlaceholder" @input="clearErr('content')" />
      <span v-if="err.content" class="error">{{ err.content }}</span>
    </div>

    <div v-if="form.type === 'plan-template'" class="form-field">
      <label>Протокол Plangent</label>
      <textarea class="content-editor protocol-editor" :value="lockedPlanProtocol" rows="9" readonly />
      <span class="hint">Это контракт движка Plangent. Структуру плана меняйте выше. Шаги должны оставаться чекбоксами <code>- [ ]</code>, иначе Plangent не увидит их для очереди выполнения.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { Agent, LibraryItemType } from '@core/models'

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
defineEmits<{ copySystemDefault: [] }>()
const { form } = props

const TYPES: { value: LibraryItemType; label: string }[] = [
  { value: 'skill', label: 'Скилл' },
  { value: 'command', label: 'Команда' },
  { value: 'main', label: 'Главный файл' },
  { value: 'plan-template', label: 'Шаблон плана' },
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
  skill: 'Инструкция, которую агент подключает сам по релевантности (по полю «Когда применять»).',
  command: 'Готовая инструкция, вызывается вручную как /команда.',
  main: 'Главные инструкции — всегда в контексте агента, у каждого агента раскладываются в свой главный файл. Может быть только один.',
  'plan-template': 'Структура плана для режима планирования. Протокол шагов добавляется ниже и не редактируется.',
}[form.type]))

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}
const slugPreview = computed(() => slugify(form.title) || 'name')

const descPlaceholder = computed(() => form.type === 'command'
  ? 'Что делает команда (необязательно)'
  : form.type === 'plan-template'
    ? 'Например: дефолтный шаблон планирования'
  : 'Например: при работе с миграциями БД (необязательно)')
const descHint = computed(() => form.type === 'command'
  ? 'Короткая подсказка для списка команд. Можно оставить пустым.'
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
  if (form.type !== 'main') {
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
label { font-size: 12px; color: var(--text-muted); }
.req { color: var(--red, #e5484d); }
.hint { font-size: 11px; color: var(--text-muted); opacity: 0.75; line-height: 1.4; }
.hint code { font-family: 'Cascadia Code', monospace; background: var(--bg3); padding: 0 4px; border-radius: 3px; }
.error { font-size: 11px; color: var(--red, #e5484d); }
.checkbox-label { flex-direction: row; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--text); }

.notice {
  font-size: 12px; color: var(--text); background: var(--bg3);
  border: 1px solid var(--border); border-left: 3px solid var(--red, #e5484d);
  border-radius: var(--radius); padding: 8px 12px; line-height: 1.4;
}

input:not([type="checkbox"]) {
  background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); padding: 6px 10px; font-size: 13px;
}
input:focus { outline: none; border-color: var(--blue); }
input:disabled { opacity: 0.5; }
.invalid input:not([type="checkbox"]), .invalid .content-editor { border-color: var(--red, #e5484d); }

.type-tabs { display: flex; gap: 6px; }
.type-tab {
  flex: 1; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-muted); padding: 7px 10px; cursor: pointer; font-size: 13px; transition: all 0.1s;
}
.type-tab:hover:not(:disabled) { color: var(--text); }
.type-tab.active { background: var(--blue); color: #fff; border-color: var(--blue); }
.type-tab:disabled { opacity: 0.4; cursor: not-allowed; }

.agent-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.agent-chip {
  background: var(--bg3); border: 1px solid var(--border); border-radius: 999px;
  color: var(--text-muted); padding: 4px 12px; cursor: pointer; font-size: 12px; transition: all 0.1s;
}
.agent-chip:hover { color: var(--text); }
.agent-chip.active { background: var(--blue); color: #fff; border-color: var(--blue); }

.content-editor {
  background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12px; padding: 10px; resize: vertical; min-height: 200px;
}
.content-editor:focus { outline: none; border-color: var(--blue); }
.template-toolbar { display: flex; justify-content: flex-end; margin-bottom: 2px; }
.protocol-editor { opacity: 0.78; resize: none; }
</style>
