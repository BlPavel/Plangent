<template>
  <div ref="root" class="split-pane" :class="{ dragging }">
    <div class="split-start" :style="{ flexBasis: `${share}%` }"><slot name="start" /></div>
    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="Потяните, чтобы изменить ширину. Двойной клик — поровну"
      @pointerdown="startDrag"
      @dblclick="setShare(50)"
    />
    <div class="split-end"><slot name="end" /></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

/** Two panes with a draggable divider; the share of the first pane is remembered under `storageKey`. */
const props = defineProps<{ storageKey: string }>()
const root = ref<HTMLElement>()
const dragging = ref(false)
const share = ref(readShare())
function readShare() {
  try { const saved = Number(localStorage.getItem(props.storageKey)); return saved >= 20 && saved <= 80 ? saved : 50 } catch { return 50 }
}
function setShare(value: number) {
  share.value = Math.min(80, Math.max(20, Math.round(value * 10) / 10))
  try { localStorage.setItem(props.storageKey, String(share.value)) } catch { /* storage unavailable */ }
}
function startDrag(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  const box = root.value!.getBoundingClientRect()
  handle.setPointerCapture(event.pointerId)
  dragging.value = true
  const move = (e: PointerEvent) => setShare(((e.clientX - box.left) / box.width) * 100)
  const stop = () => {
    dragging.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)
}
</script>

<style scoped>
.split-pane { flex: 1; min-height: 0; display: flex; }
.split-pane.dragging { cursor: col-resize; user-select: none; }
.split-start { flex-grow: 0; flex-shrink: 0; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.split-end { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.splitter { position: relative; width: 1px; flex-shrink: 0; background: var(--border); cursor: col-resize; touch-action: none; }
.splitter::before { content: ''; position: absolute; inset: 0 -4px; }
.splitter:hover, .dragging .splitter { background: var(--blue); box-shadow: 0 0 0 1px var(--blue); }
</style>
