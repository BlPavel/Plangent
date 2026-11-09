<template>
  <div class="settings">
    <AppSelect
      :model-value="policy"
      :options="POLICIES"
      :heading="POLICY_HEADING"
      :popup-max-width="220"
      size="sm"
      placement="top"
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
      placement="top"
      variant="subtle"
      :disabled="(select.kind === 'mode' && locked) || (select.kind === 'model' && busy)"
      @update:model-value="pick(select, $event)"
    />
    <AppSwitch
      v-if="split.plan"
      :model-value="split.plan.active"
      :disabled="locked && split.plan.select.kind === 'mode'"
      :title="split.plan.active ? 'Сначала план — включено. Агент изучает код и предлагает план, ничего не меняя.' : 'Сначала план: агент изучит код и предложит план, ничего не меняя'"
      small
      @update:model-value="togglePlan"
    >
      План
    </AppSwitch>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppSwitch from '@shared/ui/AppSwitch.vue'
import { POLICIES, POLICY_HEADING, splitPlan, type AgentSelect } from '../utils/agent-options'

/** Policy, agent mode/model/reasoning selects and the "plan first" toggle, shown under the composer. */
const props = defineProps<{ policy: string; selects: AgentSelect[]; locked?: boolean; busy?: boolean }>()
const emit = defineEmits<{ policy: [value: string]; change: [select: AgentSelect, value: string] }>()

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
