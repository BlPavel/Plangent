<template><component :is="as" class="card" :class="[padding,tone]"><slot /></component></template><script setup lang="ts">
withDefaults(defineProps<{
    as?: 'div' | 'section' | 'article';
    padding?: 'none' | 'sm' | 'md';
    tone?: 'default' | 'warning' | 'danger';
}>(), { as: 'div', padding: 'md', tone: 'default' });
</script><style scoped>.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);min-width:0}.sm{padding:var(--sp-2)}.md{padding:var(--sp-4)}.warning{border-color:var(--warning);background:var(--warning-soft)}.danger{border-color:var(--danger);background:var(--danger-soft)}</style>
