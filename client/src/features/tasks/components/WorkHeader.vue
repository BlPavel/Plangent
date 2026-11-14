<template>
  <div class="work-header app-drag">
    <AppButton variant="subtle" size="sm" @click="$emit('back')">← Задачи</AppButton>
    <div class="work-title-block">
      <span class="work-kind" :title="task.kind === 'errand' ? 'Поручение' : 'Задача с планом'">{{ task.kind === 'errand' ? '⚡' : '📋' }}</span>
      <code v-if="task.external_key" class="work-key">{{ task.external_key }}</code>
      <span class="work-name">{{ task.title || (task.external_key ? '' : '—') }}</span>
      <span v-if="branch" class="work-branch" :title="'Ветка работы: ' + branch">⎇ {{ branch }}</span>
      <span v-if="mainFolder" class="work-main" title="Работа идёт в основной папке проекта: одновременно там может идти только одна работа">основная папка</span>
    </div>
    <div class="actions">
      <slot name="actions" />
      <AppMenu v-if="menu.length" :items="menu" title="Ещё" />
    </div>
  </div>
</template>
<script setup lang="ts">
import type { Task } from '@contracts'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu, { type MenuItem } from '@shared/ui/AppMenu.vue'

/** The work's identity only: its state is told by the stage marks, its actions sit by the stages. */
defineProps<{ task: Task; branch?: string | null; mainFolder?: boolean; menu: MenuItem[] }>()
defineEmits<{ back: [] }>()
</script>
<style scoped>
.work-header { display: flex; align-items: center; gap: var(--sp-3); padding: calc(var(--titlebar-h) + var(--sp-2)) var(--sp-5) var(--sp-3); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.work-title-block { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--sp-2); flex-wrap: wrap; }
/* The key and the title share the text baseline; the emoji and the branch pill sit at the line's centre, or they drop below it. */
.work-kind, .work-branch { align-self: center; }
.work-kind { font-size: var(--fs-base); line-height: 1; }
.work-key { font-size: var(--fs-md); color: var(--text-muted); font-family: var(--font-mono); }
.work-name { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.01em; }
.work-branch { padding: 1px 8px; border-radius: var(--radius-pill); background: var(--bg3); border: 1px solid var(--border); font-size: var(--fs-sm); font-family: var(--font-mono); color: var(--text-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-main { font-size: var(--fs-sm); color: var(--warning-text); }
.actions { display: flex; align-items: center; gap: var(--sp-2); }
</style>
