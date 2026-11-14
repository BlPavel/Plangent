<template>
  <div role="radiogroup" :aria-label="label" class="choices">
    <label v-for="option in options" :key="option.value" class="choice" :class="{ selected: modelValue === option.value, secondary: option.secondary, disabled: disabled || option.disabled }" :data-choice="option.value">
      <input type="radio" :name="name" :value="option.value" :checked="modelValue === option.value" :disabled="disabled || option.disabled" @change="emit('update:modelValue', option.value)" />
      <span class="mark" aria-hidden="true" />
      <span class="body">
        <span class="title"><span class="text">{{ option.label }}</span><AppBadge v-if="option.badge" tone="done">{{ option.badge }}</AppBadge></span>
        <span v-if="option.hint" class="hint">{{ option.hint }}</span>
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance } from 'vue';
import AppBadge from './AppBadge.vue';
/** A single choice among options that need a line of explanation each: a list of selectable tiles with radio semantics. */
defineProps<{
    modelValue: string | null;
    options: {
        value: string;
        label: string;
        hint?: string;
        /** A short mark next to the label, e.g. a recommendation. */
        badge?: string;
        /** A fallback choice («own answer»): drawn quieter than the real options. */
        secondary?: boolean;
        disabled?: boolean;
    }[];
    label?: string;
    disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const name = 'choice-' + getCurrentInstance()!.uid;
</script>

<style scoped>
.choices { display: flex; flex-direction: column; gap: var(--sp-1); }
.choice { position: relative; display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text); cursor: pointer; transition: border-color var(--motion-fast), background var(--motion-fast); }
.choice:hover { border-color: var(--border-strong); background: var(--bg-hover); }
.choice.selected { border-color: var(--blue); background: var(--blue-soft); }
.choice.secondary { border-style: dashed; background: transparent; }
.choice.secondary.selected { border-style: solid; background: var(--blue-soft); }
.choice:has(input:focus-visible) { outline: var(--focus-outline); outline-offset: 1px; }
.choice.disabled { opacity: .5; cursor: not-allowed; }
.choice input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
.mark { flex-shrink: 0; width: 14px; height: 14px; margin-top: 3px; border: 1.5px solid var(--border-strong); border-radius: var(--radius-round); }
.selected .mark { border: 4px solid var(--blue-hover); background: var(--bg); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); font: var(--fw-medium) var(--fs-md)/var(--lh-normal) var(--font-sans); }
.text { overflow-wrap: anywhere; }
.secondary .title { color: var(--text-muted); font-weight: var(--fw-normal); }
.secondary.selected .title { color: var(--text); }
.hint { font: var(--fs-sm)/var(--lh-normal) var(--font-sans); color: var(--text-muted); overflow-wrap: anywhere; }
</style>
