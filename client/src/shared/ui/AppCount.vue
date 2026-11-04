<template><AppBadge :tone="tone">{{ value }}</AppBadge></template><script setup lang="ts">
import AppBadge from './AppBadge.vue';
defineProps<{
    value: number;
    tone?: string;
}>();
</script>
