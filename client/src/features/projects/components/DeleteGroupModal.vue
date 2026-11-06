<template>
  <AppModal :model-value="modelValue" :title="`Удалить группу «${group.name}»?`" @update:model-value="close">
    <p class="text">Задачи и чаты самой группы будут удалены безвозвратно.</p>
    <AppRadioGroup v-if="members.length" v-model="keep" vertical label="Проекты группы" :disabled="deleting" :options="[
      { value: 'keep', label: 'Оставить проекты', hint: 'Они останутся без группы' },
      { value: 'delete', label: 'Удалить проекты вместе с группой', hint: `${members.map(m => m.name).join(', ')} — их задачи, чаты и настройки. Папки на диске не меняются.` },
    ]" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #actions>
      <AppButton variant="ghost" :disabled="deleting" @click="close">Отмена</AppButton>
      <AppButton variant="danger" :disabled="deleting" @click="remove">{{ deleting ? 'Удаление…' : 'Удалить' }}</AppButton>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '@contracts'
import { AppButton, AppModal, AppRadioGroup } from '@shared/ui'
import { errorText } from '@shared/utils/errorText'
import { useProjectsStore } from '../stores/projects'

/** Deleting a group asks what happens to its projects: they leave the group or go with it. */
const props = defineProps<{ modelValue: boolean; group: Project }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; deleted: [] }>()
const projects = useProjectsStore()
const members = computed(() => projects.members(props.group.id))
const keep = ref<'keep' | 'delete'>('keep')
const deleting = ref(false), error = ref('')

function close() { if (!deleting.value) emit('update:modelValue', false) }

async function remove() {
  deleting.value = true
  error.value = ''
  try {
    if (keep.value === 'delete') for (const member of members.value) await projects.remove(member.id)
    await projects.remove(props.group.id)
    emit('update:modelValue', false)
    emit('deleted')
  } catch (cause) { error.value = errorText(cause) }
  finally { deleting.value = false }
}
</script>

<style scoped>
.text { font-size: var(--fs-md); color: var(--text-muted); }
.error { font-size: var(--fs-sm); color: var(--danger-hover); }
</style>
