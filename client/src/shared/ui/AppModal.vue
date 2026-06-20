<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="overlay" @click.self="$emit('update:modelValue', false)">
        <div class="modal" :class="size === 'large' ? 'modal--large' : ''">
          <h2 class="modal-title">{{ title }}</h2>
          <div class="modal-body">
            <slot />
          </div>
          <div class="modal-actions">
            <AppButton variant="ghost" @click="$emit('update:modelValue', false)">Отмена</AppButton>
            <AppButton variant="primary" @click="$emit('confirm')">{{ confirmLabel ?? 'Сохранить' }}</AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import AppButton from './AppButton.vue'
defineProps<{
  modelValue: boolean
  title: string
  confirmLabel?: string
  size?: 'default' | 'large'
}>()
defineEmits<{
  'update:modelValue': [v: boolean]
  'confirm': []
}>()
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
  z-index: 100;
}
.modal {
  background: var(--bg2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  width: 500px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.modal-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.modal-body { display: flex; flex-direction: column; gap: var(--sp-3); }
.modal-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }
.modal--large { width: 720px; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s; }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform 0.15s ease, opacity 0.15s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: translateY(8px) scale(0.98); opacity: 0; }
</style>
