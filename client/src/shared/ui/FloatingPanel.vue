<template>
  <Teleport to="body">
    <section v-if="modelValue" ref="panel" class="floating" :style="{ left: x + 'px', top: y + 'px', width: width + 'px' }" role="dialog" :aria-label="title">
      <header class="floating-bar" @pointerdown="startDrag">
        <h2 class="floating-title">{{ title }}</h2>
        <AppButton variant="subtle" size="xs" icon title="Закрыть" aria-label="Закрыть" @pointerdown.stop @click="$emit('update:modelValue', false)">×</AppButton>
      </header>
      <div class="floating-body"><slot /></div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import AppButton from './AppButton.vue'

/** A panel without an overlay: the page behind stays usable, the panel is dragged by its title and resized by the corner. */
const props = withDefaults(defineProps<{ modelValue: boolean; title: string; width?: number }>(), { width: 640 })
defineEmits<{ 'update:modelValue': [value: boolean] }>()

const panel = ref<HTMLElement>()
const x = ref(0), y = ref(0)
const margin = 8
// Opens near the top right, where it does not cover the editor's text.
watch(() => props.modelValue, open => {
  if (!open) return
  x.value = Math.max(margin, window.innerWidth - props.width - 24)
  y.value = 72
}, { immediate: true })

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !panel.value) return
  const startX = event.clientX - x.value, startY = event.clientY - y.value
  const move = (e: PointerEvent) => {
    const box = panel.value?.getBoundingClientRect()
    x.value = Math.min(Math.max(margin, e.clientX - startX), window.innerWidth - (box?.width ?? props.width) - margin)
    y.value = Math.min(Math.max(margin, e.clientY - startY), window.innerHeight - 48)
  }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
</script>

<style scoped>
.floating {
  position: fixed; z-index: var(--z-popover); display: flex; flex-direction: column;
  min-width: 360px; min-height: 240px; max-width: 96vw; max-height: 88vh;
  background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  resize: both; overflow: hidden;
}
.floating-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border); cursor: grab; user-select: none; touch-action: none; flex-shrink: 0; }
.floating-bar:active { cursor: grabbing; }
.floating-title { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.floating-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
</style>
