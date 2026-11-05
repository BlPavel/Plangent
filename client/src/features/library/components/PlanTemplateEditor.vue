<template>
  <InstructionTextEditor
    :type="type" :scope="scope" :project-id="projectId" :title="cfg.title" :description="cfg.description"
    :allow-empty="type === 'plan-template'" placeholder="Текст шаблона (Markdown)"
    group-label="шаблон группы" saved-toast="Шаблон сохранён" reset-question="Вернуть предустановленный шаблон?"
  >
    <details v-if="protocol" class="protocol">
      <summary>Протокол Plangent</summary>
      <p>Plangent добавляет этот блок к инструкции автоматически. Он не сохраняется в пользовательский шаблон.</p>
      <AppTextarea mono block rows="9" :model-value="protocol" spellcheck="false" readonly aria-label="Протокол Plangent" />
    </details>
  </InstructionTextEditor>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LibraryScope } from '@contracts'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { libraryDefaults } from '../api'
import InstructionTextEditor from './InstructionTextEditor.vue'

/** The plan template and the «как писать» texts of the materials: an instruction text plus the locked protocol Plangent appends. */
const props = withDefaults(defineProps<{
  scope: LibraryScope
  projectId?: string
  type?: 'plan-template' | 'architecture-template' | 'qa-template'
}>(), { type: 'plan-template' })

const CONFIG = {
  'plan-template': { title: 'Шаблон плана', description: 'Текст для планирования. Можно оставить пустым.' },
  'architecture-template': { title: 'Как писать архитектуру', description: 'Как писать материал. Если своё не задано, применяется встроенный текст.' },
  'qa-template': { title: 'Как писать QA', description: 'Как писать материал. Если своё не задано, применяется встроенный текст.' },
} as const
const cfg = computed(() => CONFIG[props.type])

const protocol = ref('')
watch(() => props.type, async type => { protocol.value = (await libraryDefaults(type)).lockedProtocol }, { immediate: true })
</script>

<style scoped>
.protocol { flex-shrink: 0; }
.protocol summary { cursor: pointer; font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); }
.protocol summary:hover { color: var(--text); }
.protocol p { margin: var(--sp-2) 0; color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.45; }
</style>
