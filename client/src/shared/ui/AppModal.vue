<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="overlay">
        <div class="modal" :class="size === 'large' ? 'modal--large' : size === 'small' ? 'modal--small' : ''">
          <h2 class="modal-title">{{ title }}</h2>
          <div class="modal-body">
            <slot />
          </div>
          <div class="modal-actions">
            <slot name="actions">
              <AppButton variant="ghost" @click="$emit('update:modelValue', false)">Отмена</AppButton>
              <AppButton variant="primary" @click="$emit('confirm')">{{ confirmLabel ?? 'Сохранить' }}</AppButton>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue';
defineProps<{
    modelValue: boolean;
    title: string;
    confirmLabel?: string;
    size?: 'default' | 'small' | 'large';
}>();
defineEmits<{
    'update:modelValue': [
        v: boolean
    ];
    'confirm': [
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
  z-index: var(--z-modal);
}
.modal {
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  width: 500px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.modal-title { font-size: var(--fs-xl); font-weight: var(--fw-bold); letter-spacing: -0.01em; flex-shrink: 0; }
.modal-body { display: flex; flex-direction: column; gap: var(--sp-3); overflow-y: auto; min-height: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); flex-shrink: 0; }
.modal--large { width: 720px; }
.modal--small { width: 380px; padding: 20px; }
.modal-enter-active, .modal-leave-active { transition: opacity var(--motion-modal); }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform var(--motion-modal) ease, opacity var(--motion-modal); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: translateY(8px) scale(0.98); opacity: 0; }
</style>
