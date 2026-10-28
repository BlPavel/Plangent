<template>
  <div class="picker">
    <AppSelect v-model="agentId" :options="agents.agents.map(a => ({ value: a.id, label: a.name }))" prefix="Агент" size="sm" />
    <AppSelect v-if="options.models.length" v-model="model" :options="options.models" prefix="Модель" size="sm" />
    <AppSelect v-if="options.efforts.length" v-model="effort" :options="options.efforts" prefix="Рассуждения" size="sm" />
    <span v-if="optionsError" role="status">{{ optionsError }} <button type="button" @click="chat.fetchAgentOptions(agentId, true)">Повторить</button></span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useChatStore, modelAndEffort } from '@features/agent-chat'
import AppSelect from '@shared/ui/AppSelect.vue'
import type { Launch } from '../../plan-review/types'
const props = defineProps<{ modelValue: Launch; defaultAgentId?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [input: Launch] }>()
const agents = useAgentsStore(), chat = useChatStore()
const agentId = ref(props.modelValue.agent_id || props.defaultAgentId || agents.agents[0]?.id || '')
// Like the queue builder: until changed, the model and reasoning are the agent's own settings.
const modelOverride = ref<string | null>(props.modelValue.model || null), effortOverride = ref<string | null>(props.modelValue.reasoning_effort || null)
const agent = computed(() => agents.agents.find(a => a.id === agentId.value))
const model = computed({ get: () => modelOverride.value ?? agent.value?.model ?? '', set: v => { modelOverride.value = v } })
const effort = computed({ get: () => effortOverride.value ?? agent.value?.reasoning_effort ?? '', set: v => { effortOverride.value = v } })
const options = computed(() => modelAndEffort(chat.agentOptions[agentId.value]))
const optionsError = computed(() => { const value = chat.agentOptions[agentId.value]; return value && 'error' in value ? value.error : '' })
watch(agentId, id => { modelOverride.value = null; effortOverride.value = null; if (id) void chat.fetchAgentOptions(id) })
watch(() => agents.agents.length, () => { if (!agentId.value) agentId.value = props.defaultAgentId || agents.agents[0]?.id || '' })
if (agentId.value && !chat.agentOptions[agentId.value]) void chat.fetchAgentOptions(agentId.value)
watch([agentId, model, effort], () => emit('update:modelValue', { agent_id: agentId.value, ...(model.value ? { model: model.value } : {}), ...(effort.value ? { reasoning_effort: effort.value } : {}) }), { immediate: true })
</script>
<style scoped>
.picker { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.picker > span { color: var(--text-muted); }
</style>
