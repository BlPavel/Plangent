<template>
  <div class="picker">
    <label>Агент
      <PlainSelect v-model="agentId" :options="agents.agents.map(a => ({ value: a.id, label: a.name }))" label="Агент" />
    </label>
    <label>Модель
      <PlainSelect v-if="options.models.length" v-model="model" :options="[{ value: '', label: 'Из настройки агента' }, ...options.models]" label="Модель" />
      <span v-else>Из настройки агента</span>
    </label>
    <label>Рассуждения
      <PlainSelect v-if="options.efforts.length" v-model="effort" :options="[{ value: '', label: 'Из настройки агента' }, ...options.efforts]" label="Рассуждения" />
      <span v-else>Из настройки агента</span>
    </label>
    <span v-if="optionsError" role="status">{{ optionsError }} <button type="button" @click="chat.fetchAgentOptions(agentId, true)">Повторить</button></span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import PlainSelect from '@shared/ui/PlainSelect.vue'
import type { Launch } from '../../plan-review/types'
const props = defineProps<{ modelValue: Launch; defaultAgentId?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [input: Launch] }>()
const agents = useAgentsStore(), chat = useChatStore()
const agentId = ref(props.modelValue.agent_id || props.defaultAgentId || agents.agents[0]?.id || '')
const model = ref(props.modelValue.model || ''), effort = ref(props.modelValue.reasoning_effort || '')
const options = computed(() => modelAndEffort(chat.agentOptions[agentId.value]))
const optionsError = computed(() => { const value = chat.agentOptions[agentId.value]; return value && 'error' in value ? value.error : '' })
watch(agentId, id => { model.value = ''; effort.value = ''; if (id) void chat.fetchAgentOptions(id) })
watch(() => agents.agents.length, () => { if (!agentId.value) agentId.value = props.defaultAgentId || agents.agents[0]?.id || '' })
if (agentId.value && !chat.agentOptions[agentId.value]) void chat.fetchAgentOptions(agentId.value)
watch([agentId, model, effort], () => emit('update:modelValue', { agent_id: agentId.value, ...(model.value ? { model: model.value } : {}), ...(effort.value ? { reasoning_effort: effort.value } : {}) }), { immediate: true })
</script>
<style scoped>
.picker, label { display: flex; flex-direction: column; gap: 6px; }
.picker { gap: 12px; } label > span { color: var(--text-muted); }
</style>

