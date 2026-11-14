<template>
  <header class="page-header">
    <div class="page-header-text">
      <h2 class="page-header-title">
        <template v-if="parent"><span class="page-header-parent">{{ parent }}</span><span class="page-header-sep" aria-hidden="true">·</span></template>{{ title }}
      </h2>
      <p v-if="description" class="page-header-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header-actions"><slot name="actions" /></div>
  </header>
</template>

<script setup lang="ts">
/** The title of a page: the section name (with its parent muted before it), an optional line under it and the page's actions on the right. */
defineProps<{ title: string; parent?: string; description?: string }>()
</script>

<style scoped>
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); min-width: 0; }
.page-header-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.page-header-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--sp-2); font-size: var(--fs-xl); font-weight: var(--fw-bold); letter-spacing: -0.01em; }
.page-header-parent, .page-header-sep { color: var(--text-faint); font-weight: var(--fw-medium); }
.page-header-description { max-width: 720px; font-size: var(--fs-sm); line-height: 1.45; color: var(--text-muted); }
.page-header-actions { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
</style>
