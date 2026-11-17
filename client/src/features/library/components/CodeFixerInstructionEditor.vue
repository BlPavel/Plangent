<template>
  <InstructionTextEditor
    :type="type" :scope="scope" :project-id="projectId" :title="cfg.title" :description="cfg.description"
    placeholder="Текст инструкции (Markdown, лучше на английском)"
  />
</template>

<script setup lang="ts">
import { LIBRARY_TYPES } from '../../../../../common/library-registry'
import { computed } from 'vue'
import type { LibraryScope } from '@contracts'
import InstructionTextEditor from './InstructionTextEditor.vue'

/** One editor for every rule text with project / group / global levels and a built-in default. */
const props = withDefaults(defineProps<{ scope: LibraryScope; projectId?: string; type?: 'code-fixer-instruction' | 'commit-rules' | 'mr-rules' | 'plan-review-instruction' | 'mr-review-instruction' | 'architecture-review-instruction' | 'qa-review-instruction' | 'interview-instruction' }>(), { type: 'code-fixer-instruction' })
const COMMON = 'Общая инструкция для всех проектов. Если своя не задана, применяется встроенная.'
const LEVELS = 'Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.'
const CONFIG = {
  'interview-instruction': { description: COMMON },
  'qa-review-instruction': { description: 'Правила для агента, который проверяет материал QA: что искать, на что не обращать внимания. ' + LEVELS },
  'architecture-review-instruction': { description: 'Правила для агента, который проверяет материал «Архитектура»: что искать, на что не обращать внимания. ' + LEVELS },
  'code-fixer-instruction': {
    description: 'Ваши правила для агента, который исполняет замечания ревью кода: что ему можно трогать, чего избегать, как отчитываться. Как читать замечания и вопросы и как их закрывать, агент получает от Plangent вместе с самими пунктами — здесь это описывать не нужно. Git и запись вне папки проекта запрещены в любом случае. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
  'plan-review-instruction': {
    description: 'Ваши правила для агента, который проверяет план задачи по материалам анализа: что искать, на что не обращать внимания. Как оформлять замечания, сводку и таблицу покрытия, агент получает от Plangent — здесь это описывать не нужно. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
  'mr-review-instruction': {
    description: 'Общие проверки при ревью merge request: что искать, на что не обращать внимания. Как оформлять обзор и замечания, агент получает от Plangent — здесь это описывать не нужно. Для ревью ветки и для ревью задачи. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
  'mr-rules': {
    description: 'Как агент пишет заголовок и описание МР: формат заголовка, нужно ли тело, что в нём указывать. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
  'commit-rules': {
    description: 'Как агент пишет сообщения коммитов: язык, длина, стиль, формат заголовка. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
} as const
const cfg = computed(() => ({ ...CONFIG[props.type], title: LIBRARY_TYPES[props.type].editorTitle }))
</script>
