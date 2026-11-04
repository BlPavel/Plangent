import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * Reveals growth of a streamed string gradually, the way chat UIs type out answers.
 * Text present at mount is shown instantly; later growth is revealed frame by frame,
 * speeding up when far behind so the display never lags much behind the source.
 */
export function useSmoothText(source: () => string) {
  const shown = ref(source())
  const catching = ref(false)
  let frame = 0

  function tick() {
    const target = source()
    if (!target.startsWith(shown.value)) shown.value = target // replaced, not appended
    const backlog = target.length - shown.value.length
    if (backlog <= 0) { frame = 0; catching.value = false; return }
    shown.value = target.slice(0, shown.value.length + Math.max(2, Math.ceil(backlog / 18)))
    frame = requestAnimationFrame(tick)
  }

  watch(source, () => {
    if (frame) return
    catching.value = true
    frame = requestAnimationFrame(tick)
  })
  onBeforeUnmount(() => cancelAnimationFrame(frame))

  return { shown, catching }
}
