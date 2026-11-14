<template>
  <InstructionTextEditor
    type="instruction-guide" :scope="scope" :project-id="projectId" :title="LIBRARY_TYPES['instruction-guide'].editorTitle"
    description="По нему агент-библиотекарь решает, куда записать знание (скилл, главный файл, команда) и как оформить текст. Действует ближайший уровень: проект, группа, глобальное; если нигде не задано — предустановленное."
    placeholder="Текст руководства (Markdown, лучше на английском — так же, как пишутся сами инструкции)"
    group-label="руководство группы" saved-toast="Руководство сохранено" reset-question="Удалить своё руководство?"
  />
</template>

<script setup lang="ts">
import { LIBRARY_TYPES } from '../../../../../common/library-registry'
import type { LibraryScope } from '@contracts'
import InstructionTextEditor from './InstructionTextEditor.vue'

defineProps<{ scope: LibraryScope; projectId?: string }>()
</script>
