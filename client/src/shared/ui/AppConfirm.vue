<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="store.confirmState" class="overlay" @click.self="store.resolveConfirm(false)">
        <div class="modal">
          <h2 class="modal-title">{{ store.confirmState.title ?? 'Подтверждение' }}</h2>
          <p class="modal-message">{{ store.confirmState.message }}</p>
          <div class="modal-actions">
            <AppButton variant="ghost" @click="store.resolveConfirm(false)">
              {{ store.confirmState.cancelLabel ?? 'Отмена' }}
            </AppButton>
            <AppButton
              :variant="store.confirmState.danger === false ? 'primary' : 'danger'"
              @click="store.resolveConfirm(true)"
            >
              {{ store.confirmState.confirmLabel ?? 'Удалить' }}
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue'
import { useAppStore } from '@core/stores/app'

const store = useAppStore()
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.72);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
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
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.modal-message {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
}
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s; }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform 0.15s ease, opacity 0.15s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: translateY(8px) scale(0.98); opacity: 0; }
</style>
