<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="t in store.toasts"
        :key="t.id"
        class="toast"
        :class="t.type"
        @click="store.dismissToast(t.id)"
      >
        {{ t.msg }}
        <button v-if="t.action" type="button" class="toast-action" @click.stop="store.dismissToast(t.id); t.action.run()">{{ t.action.label }}</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '@core/stores/app'
const store = useAppStore()
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
}
.toast {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  font-size: 13px;
  max-width: 320px;
  word-break: break-word;
  cursor: pointer;
}
.toast-action { display: block; margin-top: 6px; padding: 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.toast-action:hover { text-decoration: underline; }
.toast.error { border-color: var(--danger); }
.toast.success { border-color: var(--accent); }
.toast-enter-active, .toast-leave-active { transition: all 0.2s; }
.toast-enter-from { transform: translateX(16px); opacity: 0; }
.toast-leave-to { transform: translateX(16px); opacity: 0; }
</style>
