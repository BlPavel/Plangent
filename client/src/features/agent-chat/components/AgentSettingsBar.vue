<template>
  <div class="settings">
    <AppSelect
      :model-value="policy"
      :options="POLICIES"
      :heading="POLICY_HEADING"
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
      size="sm"
      placement="top"
      variant="subtle"
      :disabled="(select.kind === 'mode' && locked) || (select.kind === 'model' && busy)"
      @update:model-value="pick(select, $event)"
    />
    <button
      v-if="split.plan"
      type="button"
      class="plan-toggle"
      :class="{ on: split.plan.active }"
      :disabled="locked && split.plan.select.kind === 'mode'"
      :title="split.plan.active ? 'Сначала план — включено. Агент изучает код и предлагает план, ничего не меняя.' : 'Сначала план: агент изучит код и предложит план, ничего не меняя'"
      @click="togglePlan"
    >
      <span class="switch" />
      План
    </button>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSelect from '@shared/ui/AppSelect.vue'
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
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 6px 2px 0; }
.plan-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: var(--size-sm);
  padding: 0 10px 0 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.plan-toggle:hover:not(:disabled) { background: var(--bg3); color: var(--text); }
.plan-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.plan-toggle.on { color: var(--blue-hover); }
.switch { position: relative; width: 24px; height: 14px; border-radius: var(--radius-pill); background: var(--border-strong); transition: background 0.15s; flex-shrink: 0; }
.switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--text); transition: transform 0.15s; }
.on .switch { background: var(--blue); }
.on .switch::after { transform: translateX(10px); background: #fff; }
</style>
