<template>
  <div class="prep" role="status" aria-live="polite">
    <AppCard class="prep-card" :tone="failed ? 'danger' : 'default'">
      <div class="prep-body">
        <span class="prep-glyph" :class="{ failed }" aria-hidden="true">{{ failed ? '!' : '⚡' }}</span>
        <h3 class="prep-title">{{ failed ? 'Не удалось подготовить рабочее место' : 'Готовим поручение' }}</h3>
        <p v-if="failed" class="prep-error">{{ workspace?.error || 'Причина не указана' }}</p>
        <p v-else class="prep-text">Чат откроется сам, как только всё будет готово. Пока можно обдумать, что написать агенту.</p>
        <ol class="prep-steps" aria-label="Подготовка">
          <li v-for="step in steps" :key="step.title" :class="step.state">
            <StageMark :state="step.mark" :live="step.state === 'active'" :label="step.title" />
            <span class="prep-step-title">{{ step.title }}</span>
            <span v-if="step.detail" class="prep-step-detail">{{ step.detail }}</span>
          </li>
        </ol>
      </div>
    </AppCard>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Workspace } from '@contracts'
import { AppCard } from '@shared/ui'
import StageMark from '@shared/ui/StageMark.vue'

/** What an errand shows between «Поручить» and the moment its agent's chat exists. */
const props = defineProps<{ workspace?: Workspace | null }>()
const failed = computed(() => props.workspace?.status === 'failed')
const folderReady = computed(() => !props.workspace || props.workspace.status === 'ready')
const steps = computed(() => [
  {
    title: 'Рабочая папка',
    detail: props.workspace?.branch ? '⎇ ' + props.workspace.branch : props.workspace ? '' : 'основная папка проекта',
    state: failed.value ? 'failed' : folderReady.value ? 'done' : 'active',
    mark: (failed.value ? 'empty' : folderReady.value ? 'ready' : 'draft') as 'empty' | 'ready' | 'draft',
  },
  {
    title: 'Подключение агента',
    detail: '',
    state: failed.value ? 'pending' : folderReady.value ? 'active' : 'pending',
    mark: (folderReady.value && !failed.value ? 'draft' : 'empty') as 'empty' | 'draft',
  },
])
</script>
<style scoped>
.prep { flex: 1; min-height: 0; display: grid; place-items: center; padding: var(--sp-6) var(--sp-5); }
.prep-card { width: min(460px, 100%); }
.prep-body { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); text-align: center; }
.prep-glyph { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-round); background: var(--blue-soft); font-size: var(--fs-xl); animation: prep-pulse var(--motion-pulse) ease-in-out infinite; }
.prep-glyph.failed { background: var(--danger-soft); color: var(--danger-hover); font-weight: 700; animation: none; }
.prep-title { margin: 0; font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.01em; }
.prep-text, .prep-error { margin: 0; max-width: 360px; font-size: var(--fs-md); line-height: var(--lh-normal); color: var(--text-muted); }
.prep-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.prep-steps { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; margin: var(--sp-2) 0 0; padding: var(--sp-3) 0 0; list-style: none; border-top: 1px solid var(--border); text-align: left; }
.prep-steps li { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-md); color: var(--text-faint); }
.prep-steps li.active, .prep-steps li.done { color: var(--text); }
.prep-steps li.failed { color: var(--danger-hover); }
.prep-step-detail { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-muted); }
@keyframes prep-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
</style>
