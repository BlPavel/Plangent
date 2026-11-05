<template>
  <div class="instruction">
    <div class="instruction-head">
      <h3 v-if="!titled">{{ title }}</h3>
      <p>{{ description }}</p>
    </div>

    <div class="effective">
      <span class="effective-label">Сейчас действует:</span>
      <span class="effective-value" :class="{ own: text.effective.value === 'own' }">{{ text.effectiveLabel.value }}</span>
    </div>

    <div class="toolbar">
      <template v-if="!text.editing.value">
        <AppButton v-if="agent" variant="blue" size="sm" :disabled="text.loading.value" @click="agent.open(agentRequest)">▸ Изменить с агентом</AppButton>
        <AppButton variant="ghost" size="sm" :disabled="text.loading.value" @click="text.startEdit">Изменить</AppButton>
      </template>
      <template v-else>
        <AppButton variant="primary" size="sm" :disabled="text.saving.value || !text.isDirty.value || (!allowEmpty && !text.content.value.trim())" @click="text.save">{{ text.saving.value ? 'Сохранение…' : 'Сохранить' }}</AppButton>
        <AppButton variant="ghost" size="sm" :disabled="text.saving.value" @click="text.cancel">Отмена</AppButton>
        <AppButton v-if="text.defaultText.value" variant="subtle" size="sm" :disabled="text.saving.value" @click="text.useDefault">Взять предустановленное за основу</AppButton>
        <AppButton v-if="text.inherited.value" variant="subtle" size="sm" :disabled="text.saving.value" @click="text.useInherited">Взять {{ text.inherited.value.label }} за основу</AppButton>
        <span class="spacer" />
        <AppButton v-if="text.own.value" variant="danger-ghost" size="sm" :disabled="text.saving.value" @click="text.reset">{{ scope === 'global' ? 'Вернуть предустановленное' : 'Сбросить переопределение' }}</AppButton>
      </template>
    </div>

    <AppTextarea
      v-model="shown" fill mono block spellcheck="false" :aria-label="title" :readonly="!text.editing.value" :disabled="text.loading.value"
      :placeholder="text.editing.value ? placeholder : 'Текст не задан'"
    />

    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { LibraryScope } from '@contracts'
import AppButton from '@shared/ui/AppButton.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { libraryAgentKey, pageTitledKey } from '../agent-context'
import { useInstructionText, type InstructionTextType } from '../composables/useInstructionText'

/** One text instruction: read it, change it by hand («Изменить») or with the agent. */
const props = defineProps<{
  type: InstructionTextType
  scope: LibraryScope
  projectId?: string
  title: string
  description: string
  placeholder?: string
  groupLabel?: string
  savedToast?: string
  resetQuestion?: string
  /** The text may be saved empty (the plan template is optional). */
  allowEmpty?: boolean
}>()
const agent = inject(libraryAgentKey, null)
const titled = inject(pageTitledKey, false)
const text = useInstructionText({
  type: () => props.type, scope: () => props.scope, projectId: () => props.projectId,
  itemTitle: () => props.title, groupLabel: () => props.groupLabel ?? 'инструкция группы',
  savedToast: () => props.savedToast ?? 'Инструкция сохранена', resetQuestion: () => props.resetQuestion ?? 'Удалить свою инструкцию?',
})
const shown = computed({
  get: () => text.editing.value ? text.content.value : text.effectiveText.value,
  set: value => { text.content.value = value },
})
const agentRequest = computed(() => `${props.scope === 'global' ? 'Глобально: измени' : 'Измени'} «${props.title}»: `)
defineExpose({ text })
</script>

<style scoped>
.instruction { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.instruction-head h3 { margin: 0 0 3px; font-size: var(--fs-base); }
.instruction-head p { margin: 0; max-width: 720px; color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.45; }
.effective { display: flex; gap: 6px; font-size: var(--fs-md); }
.effective-label { color: var(--text-muted); }
.effective-value { font-weight: 500; }
.effective-value.own { color: var(--blue-hover); }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.spacer { flex: 1; }
</style>
