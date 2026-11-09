<template><AppBadge class="count" :tone="tone">{{ value }}</AppBadge></template><script setup lang="ts">
import AppBadge from './AppBadge.vue';
defineProps<{
    value: number;
    tone?: string;
}>();
</script><style scoped>.count{min-width:16px;padding:0 5px;border-color:transparent;font-size:var(--fs-xs);line-height:1.4}</style>
