<template>
  <div class="execution-workspace">
    <div class="execution-layout" :class="{ 'agent-open': agentOpen }">
      <section class="execution-plan" aria-label="План выполнения">
        <slot name="plan" />
      </section>
      <section class="execution-right" :aria-label="agentOpen ? 'Агент' : 'Очередь выполнения'">
        <div v-show="!agentOpen" ref="overview" class="queue-overview">
          <p class="execution-guide">Выберите шаги слева и добавьте их в очередь. Нажмите на карточку, чтобы открыть агента.</p>
          <slot name="queue" />
        </div>
        <div v-if="agentOpen" class="agent-view">
          <nav class="agent-navigation" aria-label="Навигация выполнения">
            <AppButton ref="backButton" size="sm" @click="$emit('back')">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 3.5L5 8l4.5 4.5M5 8h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              К очереди
            </AppButton>
            <span>Работа агента</span>
          </nav>
          <div class="agent-content"><slot name="agent" /></div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'

const props = defineProps<{ agentOpen: boolean }>()
defineEmits<{ back: [] }>()
const overview = ref<HTMLElement>()
const backButton = ref<InstanceType<typeof AppButton>>()
let returnFocus: HTMLElement | null = null

// Keep scroll, expanded settings and history when opening an agent.
watch(() => props.agentOpen, async open => {
  if (open) {
    const active = document.activeElement
    returnFocus = active instanceof HTMLElement && overview.value?.contains(active) ? active : null
    await nextTick()
    backButton.value?.$el.focus({ preventScroll: true })
  } else {
    await nextTick()
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    returnFocus = null
  }
})
</script>

<style scoped>
.execution-workspace { flex: 1; min-height: 0; min-width: 0; container-type: inline-size; }
.execution-layout { height: 100%; display: grid; grid-template-columns: minmax(320px, 42%) minmax(0, 1fr); }
.execution-plan { min-width: 0; min-height: 0; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; border-right: 1px solid var(--border); }
.execution-right { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.queue-overview { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; }
.execution-guide { margin-bottom: 16px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
.agent-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.agent-navigation { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg2); }
.agent-navigation > span { font-size: 12px; color: var(--text-muted); }
.agent-content { flex: 1; min-height: 0; overflow: hidden; }
@container (max-width: 820px) {
  .execution-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(240px, 45%) minmax(0, 1fr); }
  .execution-plan { border-right: 0; border-bottom: 1px solid var(--border); padding: 12px; }
  .queue-overview { padding: 12px; }
  .execution-layout.agent-open { grid-template-rows: minmax(0, 1fr); }
  .agent-open .execution-plan { display: none; }
}
</style>
