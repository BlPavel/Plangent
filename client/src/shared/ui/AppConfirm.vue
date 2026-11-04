<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="state" class="overlay">
        <div class="modal">
          <h2 class="modal-title">{{ state.title ?? 'Подтверждение' }}</h2>
          <p class="modal-message">{{ state.message }}</p>
          <div class="modal-actions">
            <AppButton variant="ghost" @click="emit('resolve', false)">
              {{ state.cancelLabel ?? 'Отмена' }}
            </AppButton>
            <AppButton
              :variant="state.danger === false ? 'primary' : 'danger'"
              @click="emit('resolve', true)"
            >
              {{ state.confirmLabel ?? 'Удалить' }}
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue';
defineProps<{
    state: {
        message: string;
        title?: string;
        cancelLabel?: string;
        confirmLabel?: string;
        danger?: boolean;
    } | null;
}>();
const emit = defineEmits<{
    resolve: [
        result: boolean
    ];
}>();
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-toast);
}
.modal {
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.modal-title {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  letter-spacing: -0.01em;
}
.modal-message {
  font-size: var(--fs-md);
  color: var(--text-muted);
  line-height: var(--lh-normal);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.modal-enter-active, .modal-leave-active { transition: opacity var(--motion-modal); }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform var(--motion-modal) ease, opacity var(--motion-modal); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: translateY(8px) scale(0.98); opacity: 0; }
</style>
