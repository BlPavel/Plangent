import { ref, watch, onBeforeUnmount } from 'vue'

// Rendering Markdown is the expensive part, so the typed text is repainted at most this often.
const FRAME_MS = 50

/**
 * Reveals growth of a streamed string gradually, the way chat UIs type out answers.
 * Text present at mount is shown instantly; later growth is revealed frame by frame,
 * speeding up when far behind so the display never lags much behind the source.
 * While the window is hidden, nothing is repainted: the text jumps to its full length
 * as soon as it is visible again instead of replaying everything that arrived meanwhile.
 */
export function useSmoothText(source: () => string) {
  const shown = ref(source())
  const catching = ref(false)
  let frame = 0
  let painted = 0

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    catching.value = false
  }
  function showAll() {
    stop()
    const target = source()
    if (shown.value !== target) shown.value = target
  }
  function tick(now: number) {
    if (now - painted < FRAME_MS) { frame = requestAnimationFrame(tick); return }
    painted = now
    const target = source()
    if (!target.startsWith(shown.value)) shown.value = target // replaced, not appended
    const backlog = target.length - shown.value.length
    if (backlog <= 0) { frame = 0; catching.value = false; return }
    shown.value = target.slice(0, shown.value.length + Math.max(2, Math.ceil(backlog / 6)))
    frame = requestAnimationFrame(tick)
  }

  watch(source, () => {
    if (document.hidden || frame) return // hidden: nothing is repainted until the window is back
    catching.value = true
    frame = requestAnimationFrame(tick)
  })
  const onVisibility = () => { if (!document.hidden) showAll() }
  document.addEventListener('visibilitychange', onVisibility)
  onBeforeUnmount(() => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisibility) })

  return { shown, catching }
}
