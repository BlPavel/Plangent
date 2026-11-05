<template>
  <div :role="segmented ? 'group' : 'tablist'" :aria-label="label" :aria-orientation="variant === 'side' ? 'vertical' : 'horizontal'" class="tabs" :class="[variant, { segmented, rich, bare }]">
    <template v-for="item in items" :key="item.value">
      <div v-if="rich" role="tab" :data-id="item.value" :aria-selected="modelValue === item.value" :aria-disabled="item.disabled || undefined" :title="item.title" :tabindex="modelValue === item.value || (!items.some(i => i.value === modelValue && !i.disabled) && items.find(i => !i.disabled) === item) ? 0 : -1" :class="{ active: modelValue === item.value, disabled: item.disabled }" @click="!item.disabled && emit('update:modelValue', item.value)" @dblclick="emit('tab-dblclick', item.value)" @contextmenu.prevent="emit('tab-contextmenu', item.value, $event)" @mousedown.middle.prevent="emit('tab-middle', item.value)" @keydown="key($event, item.value)"><slot name="item" :item="item">{{ item.label }}</slot></div>
      <button v-else type="button" :role="segmented ? undefined : 'tab'" :aria-selected="segmented ? undefined : modelValue === item.value" :aria-pressed="segmented ? modelValue === item.value : undefined" :disabled="item.disabled" :title="item.title" :tabindex="modelValue === item.value || (!items.some(i => i.value === modelValue && !i.disabled) && items.find(i => !i.disabled) === item) ? 0 : -1" :class="{ active: modelValue === item.value }" @click="emit('update:modelValue', item.value)" @keydown="key($event, item.value)">{{ item.label }}<AppCount v-if="item.count !== undefined" :value="item.count" /></button>
    </template>
  </div>
</template><script setup lang="ts">
import AppCount from './AppCount.vue';
const props = withDefaults(defineProps<{
    modelValue: string;
    items: {
        value: string;
        label: string;
        disabled?: boolean;
        count?: number;
        title?: string;
    }[];
    variant?: 'line' | 'side';
    label?: string;
    segmented?: boolean;
    rich?: boolean;
    /** No bottom line, for tabs that sit inside a bar which draws its own. */
    bare?: boolean;
}>(), { variant: 'line' });
const emit = defineEmits<{
    'tab-dblclick': [value: string];
    'tab-contextmenu': [value: string, event: MouseEvent];
    'tab-middle': [value: string];
    'update:modelValue': [
        value: string
    ];
}>();
function key(event: KeyboardEvent, value: string) { if (props.rich && event.target !== event.currentTarget) return; if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return; if (props.rich && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!props.items.find(i => i.value === value)?.disabled) emit('update:modelValue', value); return; } if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
    return; event.preventDefault(); const items = props.items.filter(i => !i.disabled); const at = items.findIndex(i => i.value === value); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + items.length) % items.length; const item = items[next]; if (!item)
    return; emit('update:modelValue', item.value); const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(props.rich ? '[role=tab]:not([aria-disabled=true])' : 'button:not(:disabled)'); buttons?.[next]?.focus(); }
</script><style scoped>.tabs{display:flex;gap:var(--sp-1);border-bottom:1px solid var(--border)}.tabs.side{flex-direction:column;border-bottom:0}.tabs.bare{border-bottom:0}.tabs button{display:flex;align-items:center;gap:var(--sp-1);border:0;border-bottom:2px solid transparent;padding:var(--sp-2) var(--sp-3);color:var(--text-muted);background:transparent;font:var(--fw-medium) var(--fs-sm)/var(--lh-normal) var(--font-sans);cursor:pointer}.tabs button.active{color:var(--text);border-color:var(--blue)}.tabs button:hover:not(:disabled){background:var(--bg-hover)}.tabs button:disabled{opacity:.45;cursor:not-allowed}.tabs button:focus-visible{outline:var(--focus-outline);outline-offset:-2px}.tabs.side button.active{background:var(--blue-soft);border-color:transparent}.segmented{border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:2px;gap:2px}.segmented button{border:0;border-radius:var(--radius-xs);padding:var(--sp-1) var(--sp-2)}.segmented button.active{background:var(--blue-soft);color:var(--blue-hover)}.rich > [role=tab]{flex-shrink:0;display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-1) var(--sp-2);color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent}.rich > [role=tab].active{color:var(--text);border-color:var(--blue)}.rich > [role=tab]:focus-visible{outline:var(--focus-outline)}.rich > [role=tab].disabled{opacity:.45;cursor:not-allowed}</style>
