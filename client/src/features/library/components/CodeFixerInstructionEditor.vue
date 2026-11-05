<template>
  <InstructionTextEditor
    :type="type" :scope="scope" :project-id="projectId" :title="cfg.title" :description="cfg.description"
    placeholder="Текст инструкции (Markdown, лучше на английском)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LibraryScope } from '@contracts'
import InstructionTextEditor from './InstructionTextEditor.vue'

/** One editor for every rule text with project / group / global levels and a built-in default. */
const props = withDefaults(defineProps<{ scope: LibraryScope; projectId?: string; type?: 'code-fixer-instruction' | 'commit-rules' | 'plan-review-instruction' | 'architecture-review-instruction' | 'qa-review-instruction' | 'interview-instruction' }>(), { type: 'code-fixer-instruction' })
const COMMON = 'Общая инструкция для всех проектов. Если своя не задана, применяется встроенная.'
const CONFIG = {
  'interview-instruction': { title: 'Уточняющее интервью', description: COMMON },
  'qa-review-instruction': { title: 'Ревью QA', description: COMMON },
  'architecture-review-instruction': { title: 'Ревью архитектуры', description: COMMON },
  'code-fixer-instruction': {
    title: 'Агент доработки',
    description: 'Ваши правила для агента, который исполняет замечания ревью кода: что ему можно трогать, чего избегать, как отчитываться. Как читать замечания и вопросы и как их закрывать, агент получает от Plangent вместе с самими пунктами — здесь это описывать не нужно. Git и запись вне папки проекта запрещены в любом случае. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
  'plan-review-instruction': {
    title: 'Ревью плана',
    description: 'Ваши правила для агента, который проверяет план задачи по материалам анализа: что искать, на что не обращать внимания. Как оформлять замечания, сводку и таблицу покрытия, агент получает от Plangent — здесь это описывать не нужно. Это общие проверки для всех проектов, они действуют всегда. Свои требования проекта или группы (например, архитектурные) пишутся скиллами ревью плана в проекте. Если текст не задан — предустановленный.',
  },
  'commit-rules': {
    title: 'Правила коммитов',
    description: 'Как агент пишет сообщения коммитов: язык, длина, стиль, формат заголовка. Действует ближайший уровень: проект, группа, глобальный; если нигде не задано — предустановленный текст.',
  },
} as const
const cfg = computed(() => CONFIG[props.type])
</script>
