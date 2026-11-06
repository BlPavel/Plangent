<template><Teleport to="body" :disabled="inline"><div v-if="modelValue" ref="panel" class="popover" :class="{ inline }" :style="inline ? undefined : positionOverride ?? style" :role="role" :aria-label="label" @click.stop @keydown="navigate"><slot /></div></Teleport></template>
<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch, type CSSProperties } from 'vue';
import { usePopover } from '@shared/composables/usePopover';
const props = withDefaults(defineProps<{
    modelValue: boolean;
    anchor?: HTMLElement | null;
    at?: {
        x: number;
        y: number;
    } | null;
    align?: 'left' | 'right';
    placement?: 'top' | 'bottom';
    minWidth?: number;
    maxWidth?: number;
    /** Panel is exactly as wide as the anchor; content wraps. Otherwise it fits its content. */
    matchAnchor?: boolean;
    role?: string;
    label?: string;
    focusOnOpen?: boolean;
    inline?: boolean;
    positionOverride?: CSSProperties;
}>(), { align: 'left', placement: 'bottom', role: 'dialog' });
const emit = defineEmits<{
    'update:modelValue': [
        value: boolean
    ];
}>();
const panel = ref<HTMLElement>();
watch(() => props.modelValue, async (value) => { if (value && props.focusOnOpen) {
    await nextTick();
    (panel.value?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') ?? panel.value?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
} }, { immediate: true });
const floatingOpen = computed(() => props.modelValue && !props.inline);
const { style } = usePopover(floatingOpen, toRef(props, 'anchor'), panel, () => ({ align: props.align, placement: props.placement, at: props.at, minWidth: props.minWidth, maxWidth: props.maxWidth, matchAnchor: props.matchAnchor }), () => emit('update:modelValue', false));
function navigate(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement)
        return;
    const items = Array.from(panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), [role="option"]:not([aria-disabled="true"])'));
    if (!items.length)
        return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
}
defineExpose({ panel });
</script>
<style scoped>.popover { width: max-content; max-width: calc(100vw - 16px); z-index: var(--z-popover); overflow: auto; padding: var(--sp-1); border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg2); color: var(--text); box-shadow: var(--shadow-md); font: var(--fs-sm)/var(--lh-normal) var(--font-sans); }.popover.inline { width: auto; max-width: none; position: static; overflow: visible; padding: 0; border: 0; background: transparent; box-shadow: none; }</style>
