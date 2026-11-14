<template>
  <WhereToWork ref="picker" v-model="place" :project-id="task.project_id" :workspace-id="workspace.id" ordinary :taken="taken" :disabled="busy" :disabled-reason="lockedReason" :notice="error" @closed="resetChoice">
    <template #actions="{ invalid }">
      <AppButton variant="blue" size="sm" :disabled="busy || !!lockedReason || invalid || !canSwitch" @click="submit">{{ busy ? 'Переключение…' : 'Переключить' }}</AppButton>
    </template>
  </WhereToWork>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Task, Workspace } from '@contracts'
import AppButton from '@shared/ui/AppButton.vue'
import WhereToWork, { type WorkPlace } from './WhereToWork.vue'
import { workApi } from '../api'

const props = defineProps<{ task: Task; workspace: Workspace; taken: Record<string, string>; lockedReason?: string }>()
const emit = defineEmits<{ changed: [value: { task: Task; workspace: Workspace }] }>()
const picker = ref<InstanceType<typeof WhereToWork>>()
const place = ref<WorkPlace>({ place: 'existing', branch: props.workspace.branch, branch_name: '', base_branch: props.workspace.branch })
const error = ref(''), busy = ref(false)
const confirmedBranch = ref(props.workspace.branch)
const target = computed(() => place.value.place === 'new' ? place.value.branch_name : place.value.branch)
const canSwitch = computed(() => place.value.place === 'new' ? !!target.value.trim() && !target.value.endsWith('/') : target.value.replace(/^origin\//, '') !== props.workspace.branch)
function resetChoice() {
  place.value = { place: 'existing', branch: confirmedBranch.value, branch_name: '', base_branch: confirmedBranch.value }
  error.value = ''
}
watch(() => props.workspace.branch, branch => { confirmedBranch.value = branch; resetChoice() })
async function submit() {
  if (busy.value || props.lockedReason || picker.value?.invalid || !canSwitch.value) return
  busy.value = true; error.value = ''
  try {
    const result = await workApi.changeBranch({ params: { projectId: props.task.project_id, taskId: props.task.id },
      body: { branch: target.value.trim(), create: place.value.place === 'new', ...(place.value.place === 'new' ? { base: place.value.base_branch } : {}) } })
    confirmedBranch.value = result.workspace.branch
    emit('changed', result)
    picker.value?.closePicker()
  } catch (cause) {
    const output = (cause as { output?: string })?.output
    error.value = (cause instanceof Error ? cause.message : String(cause)) + (output ? '\n' + output : '')
  } finally { busy.value = false }
}
</script>
