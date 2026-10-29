<template>
  <div class="work-header app-drag">
    <AppButton variant="subtle" size="sm" @click="$emit('back')">← Задачи</AppButton>
    <div class="work-title-block">
      <code class="work-key">{{ task.kind === 'errand' ? '⚡' : task.key }}</code>
      <span class="work-name">{{ task.title || '—' }}</span>
      <span v-if="branch" class="work-branch" :title="'Ветка работы: ' + branch">⎇ {{ branch }}</span>
      <span v-if="state" class="work-state" :class="state.group">{{ state.icon }} {{ state.text }}</span>
    </div>
    <div class="actions">
      <slot name="actions" />
      <AppButton v-if="state?.hasBranch" size="sm" :disabled="viewing" title="Терминал и «Код» проекта покажут файлы этой ветки" @click="$emit('view')">👁 Смотреть эту ветку</AppButton>
      <AppMenu v-if="menu.length" :items="menu" title="Ещё" />
    </div>
  </div>
</template>
<script setup lang="ts">
import type { Task, WorkState } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'

defineProps<{ task: Task; state: WorkState | null; branch?: string | null; menu: MenuItem[]; viewing?: boolean }>()
defineEmits<{ back: []; view: [] }>()
</script>
<style scoped>
.work-header { display: flex; align-items: center; gap: var(--sp-3); padding: calc(var(--titlebar-h) + var(--sp-2)) var(--sp-5) var(--sp-3); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.work-title-block { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.work-key { font-size: 13px; color: var(--text-muted); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.work-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.work-branch { padding: 1px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: 12px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; color: var(--text-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-state { font-size: 12px; color: var(--text-muted); }
.work-state.attention { color: var(--warning); }
.actions { display: flex; align-items: center; gap: var(--sp-2); }
</style>
