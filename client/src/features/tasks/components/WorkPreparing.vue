<template>
  <div class="prep" role="status" aria-live="polite">
    <AppCard class="prep-card" :tone="failed ? 'danger' : 'default'">
      <div class="prep-body">
        <span class="prep-glyph" :class="{ failed }" aria-hidden="true">{{ failed ? '!' : '⚡' }}</span>
        <h3 class="prep-title">{{ failed ? 'Не удалось подготовить рабочее место' : 'Готовим поручение' }}</h3>
        <p v-if="failed" class="prep-error">{{ error || workspace?.error || 'Причина не указана' }}</p>
        <p v-if="failed && retryable" class="prep-text">Проверьте доступ к Git-серверу и подключение VPN, если оно нужно, затем повторите подготовку.</p>
        <p v-else class="prep-text">Чат откроется сам, когда агент будет готов принять задачу. Пока можно обдумать, что ему написать.</p>
        <ol class="prep-steps" aria-label="Подготовка">
          <li v-for="step in steps" :key="step.title" :class="step.state">
            <StageMark :state="mark(step.state)" :live="step.state === 'active'" :label="step.title + ': ' + stateLabel[step.state]" />
            <span class="prep-step-text">
              <span class="prep-step-title">{{ step.title }}</span>
              <span v-if="step.detail" class="prep-step-detail" :title="step.detail">{{ step.detail }}</span>
            </span>
          </li>
        </ol>
        <!-- The setup command's latest output: the developer sees that it is moving, not hung. -->
        <code v-if="logLine && !failed" class="prep-log" :title="logLine">{{ logLine }}</code>
        <AppButton v-if="retryable" :disabled="retrying" @click="$emit('retry')">{{ retrying ? 'Повторяем подготовку…' : 'Повторить подготовку' }}</AppButton>
      </div>
    </AppCard>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Workspace } from '@contracts'
import { AppButton, AppCard } from '@shared/ui'
import StageMark from '@shared/ui/StageMark.vue'

type StepState = 'done' | 'active' | 'pending' | 'failed'
/**
 * What an errand shows between «Поручить» and the moment its agent can take the request:
 * the branch and folder, the project's setup command (when there is one), the agent's connection.
 */
const props = defineProps<{ workspace?: Workspace | null; agentConnecting?: boolean; error?: string; retrying?: boolean; retryable?: boolean; /** The server has pinned where the work goes (its base commit): without a folder it is the main one. */ placed?: boolean }>()
defineEmits<{ retry: [] }>()
const failed = computed(() => props.workspace?.status === 'failed' || !!props.error)
const preparing = computed(() => props.workspace?.status === 'preparing')
const log = computed(() => props.workspace?.setup_log ?? '')
/** The setup command is logged as «$ command» before it runs (server/core/workspaces/prepare.ts). */
const command = computed(() => log.value.match(/^\$ (.+)$/m)?.[1] ?? '')
const logLine = computed(() => preparing.value && command.value ? log.value.trimEnd().split('\n').at(-1)?.slice(0, 200) ?? '' : '')
const stateLabel: Record<StepState, string> = { done: 'готово', active: 'идёт', pending: 'ожидает', failed: 'ошибка' }
const mark = (state: StepState) => state === 'done' ? 'ready' : state === 'active' ? 'draft' : 'empty'

const steps = computed(() => {
  const ws = props.workspace
  const folder: StepState = failed.value && !command.value ? 'failed' : (ws ? ws.status === 'ready' || !!command.value : props.placed) ? 'done' : 'active'
  const list: { title: string; detail: string; state: StepState }[] = [{
    title: ws || !props.placed ? 'Ветка и рабочая папка' : 'Основная папка проекта',
    detail: ws ? '⎇ ' + ws.branch + (ws.base_branch && ws.base_branch !== ws.branch ? ' от ' + ws.base_branch : '') : '',
    state: folder,
  }]
  if (command.value) list.push({ title: 'Подготовка окружения', detail: command.value,
    state: failed.value ? 'failed' : ws?.status === 'ready' ? 'done' : 'active' })
  const ready = ws ? ws.status === 'ready' : !!props.placed
  list.push({ title: 'Подключение агента', detail: '', state: failed.value ? 'pending' : !ready ? 'pending' : props.agentConnecting === false ? 'done' : 'active' })
  return list
})
</script>
<style scoped>
.prep { flex: 1; min-height: 0; display: grid; place-items: center; padding: var(--sp-6) var(--sp-5); }
.prep-card { width: min(480px, 100%); }
.prep-body { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); text-align: center; }
.prep-glyph { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-round); background: var(--blue-soft); font-size: var(--fs-xl); animation: prep-pulse var(--motion-pulse) ease-in-out infinite; }
.prep-glyph.failed { background: var(--danger-soft); color: var(--danger-hover); font-weight: 700; animation: none; }
.prep-title { margin: 0; font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.01em; }
.prep-text, .prep-error { margin: 0; max-width: 380px; font-size: var(--fs-md); line-height: var(--lh-normal); color: var(--text-muted); }
.prep-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.prep-steps { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; margin: var(--sp-2) 0 0; padding: var(--sp-3) 0 0; list-style: none; border-top: 1px solid var(--border); text-align: left; }
.prep-steps li { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-md); color: var(--text-faint); transition: color var(--motion-fast, .15s) ease; }
.prep-steps li.active, .prep-steps li.done { color: var(--text); }
.prep-steps li.failed { color: var(--danger-hover); }
.prep-step-text { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--sp-2); }
.prep-step-title { white-space: nowrap; }
.prep-step-detail { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-muted); }
.prep-log { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-faint); }
@keyframes prep-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
</style>
