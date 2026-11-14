<template><AppPopover focus-on-open :model-value="!!at" :at="at" :min-width="220" role="menu" @update:model-value="!$event && emit('close')"><template v-for="(item, i) in items" :key="i"><div v-if="item.separator" class="separator" /><div v-else-if="item.heading" class="heading">{{ item.heading }}</div><button v-else type="button" role="menuitem" class="option" :class="{ danger: item.danger }" :disabled="item.disabled" @click="pick(item)"><span>{{ item.label }}<span v-if="item.hint" class="description">{{ item.hint }}</span></span></button></template></AppPopover></template>
<script setup lang="ts">
import AppPopover from './AppPopover.vue';
import type { MenuItem } from './AppMenu.vue';
defineProps<{
    items: MenuItem[];
    at: {
        x: number;
        y: number;
    } | null;
}>();
const emit = defineEmits<{
    close: [
    ];
}>();
function pick(item: MenuItem) { if (item.disabled)
    return; emit('close'); item.action?.(); }
</script>
<style scoped>@import './styles/options.css';</style>
