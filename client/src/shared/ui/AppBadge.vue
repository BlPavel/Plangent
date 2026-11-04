<template><span class="app-badge" :class="[tone,{dot,pulse}]"><slot /></span></template><script setup lang="ts">
withDefaults(defineProps<{
    tone?: string;
    dot?: boolean;
    pulse?: boolean;
}>(), { tone: 'neutral' });
</script><style scoped>.app-badge{display:inline-flex;align-items:center;gap:var(--sp-1);padding:2px var(--sp-2);border:1px solid var(--border-strong);border-radius:var(--radius-pill);background:var(--bg3);color:var(--text-muted);font:var(--fw-semibold) var(--fs-xs)/var(--lh-tight) var(--font-sans);white-space:nowrap}.dot:before{content:'';width:6px;height:6px;border-radius:var(--radius-round);background:currentColor}.open,.info,.agent{color:var(--blue-hover);background:var(--blue-soft);border-color:var(--blue-soft)}.progress,.warning,.warn{color:var(--warning-text);background:var(--warning-soft);border-color:var(--warning-soft)}.done,.success,.add{color:var(--accent-hover);background:var(--accent-soft);border-color:var(--accent-soft)}.danger,.error,.failed,.del{color:var(--danger-hover);background:var(--danger-soft);border-color:var(--danger-soft)}.pulse{animation:badge-pulse var(--motion-pulse) ease-in-out infinite}@keyframes badge-pulse{50%{opacity:.6}}</style>
