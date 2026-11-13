<template>
  <div class="settings">
    <AppSelect
      v-if="agents?.length"
      :model-value="agent ?? ''"
      :options="agents"
      heading="Агент, который отвечает в этом чате. После смены он получит историю разговора"
      :popup-max-width="220"
      size="sm"
      :placement="placement"
      variant="subtle"
      :disabled="busy"
      @update:model-value="$emit('agent', $event)"
    />
    <AppSelect
      :model-value="policy"
      :options="POLICIES"
      :heading="POLICY_HEADING"
      :popup-max-width="220"
      size="sm"
      :placement="placement"
      variant="subtle"
      :disabled="locked"
      @update:model-value="$emit('policy', $event)"
    />
    <AppSelect
      v-for="select in split.selects"
      :key="select.configId"
      :model-value="select.current"
      :options="select.options"
      :heading="select.heading"
      :prefix="select.prefix"
      :popup-max-width="220"
      size="sm"
      :placement="placement"
      variant="subtle"
      :disabled="(select.kind === 'mode' && locked) || (select.kind === 'model' && busy)"
      @update:model-value="pick(select, $event)"
    />
    <AppSwitch
      v-if="split.plan"
      :model-value="split.plan.active"
      :disabled="locked && split.plan.select.kind === 'mode'"
      :title="split.plan.active ? 'Сначала план — включено. Агент изучает код и предлагает план, ничего не меняя.' : 'Сначала план: агент изучит код и предложит план, ничего не меняя'"
      @update:model-value="togglePlan"
    >
      План
    </AppSwitch>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSelect, { type SelectOption } from '@shared/ui/AppSelect.vue'
import AppSwitch from '@shared/ui/AppSwitch.vue'
import { POLICIES, POLICY_HEADING, splitPlan, type AgentSelect } from '../utils/agent-options'

/** Policy, agent mode/model/reasoning selects and the "plan first" toggle, shown under the composer. */
const props = withDefaults(defineProps<{ policy: string; selects: AgentSelect[]; locked?: boolean; busy?: boolean; /** Where the lists open: up under a composer at the bottom of a chat, down elsewhere. */ placement?: 'top' | 'bottom'; /** Agents to choose from; the list is shown first when the chat may change its agent. */ agents?: SelectOption[]; agent?: string }>(), { placement: 'top' })
const emit = defineEmits<{ policy: [value: string]; change: [select: AgentSelect, value: string]; agent: [value: string] }>()

// Mode to return to when plan is switched off (Claude keeps "plan" among its modes).
const lastMode = ref('')
const split = computed(() => splitPlan(props.selects, lastMode.value))

function pick(select: AgentSelect, value: string) {
  if (select.kind === 'mode') lastMode.value = value
  emit('change', select, value)
}
function togglePlan() {
  const plan = split.value.plan!
  if (!plan.active && plan.select.kind === 'mode') lastMode.value = plan.select.current
  emit('change', plan.select, plan.active ? plan.off : 'plan')
}
</script>

<style scoped>
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 2px 0; }
</style>
