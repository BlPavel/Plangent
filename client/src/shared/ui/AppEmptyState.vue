<template><div class="empty" :class="{small}" role="status"><slot name="icon" /><strong v-if="title">{{ title }}</strong><slot>{{ description }}</slot><slot name="actions" /></div></template><script setup lang="ts">
defineProps<{
    title?: string;
    description?: string;
    small?: boolean;
}>();
</script><style scoped>.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3);height:100%;padding:var(--sp-6);text-align:center;color:var(--text-muted);font-size:var(--fs-md)}.small{height:auto;padding:var(--sp-4)}</style>
