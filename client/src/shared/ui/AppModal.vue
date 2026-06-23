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
            <button class="btn btn-ghost" @click="$emit('update:modelValue', false)">Отмена</button>
            <button class="btn btn-primary" @click="$emit('confirm')">{{ confirmLabel }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
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
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 24px;
  width: 500px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.modal-title { font-size: 16px; }
.modal-body { display: flex; flex-direction: column; gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.modal--large { width: 720px; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
