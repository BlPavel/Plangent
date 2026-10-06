import type { CSSProperties } from 'vue'

/** Keep an anchored suggestion menu inside the window, preferring the space above the input. */
export function suggestPosition(anchor: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, viewport: { width: number; height: number }): CSSProperties {
  const edge = 8, gap = 6, wanted = 320
  const width = Math.max(0, Math.min(anchor.width, viewport.width - edge * 2))
  const above = Math.max(0, anchor.top - edge - gap)
  const below = Math.max(0, viewport.height - anchor.bottom - edge - gap)
  const openAbove = above >= Math.min(wanted, below)
  return {
    position: 'fixed', left: Math.max(edge, Math.min(anchor.left, viewport.width - edge - width)) + 'px',
    width: width + 'px', right: 'auto',
    maxHeight: Math.min(wanted, openAbove ? above : below) + 'px',
    top: openAbove ? 'auto' : Math.max(edge, anchor.bottom + gap) + 'px',
    bottom: openAbove ? Math.max(edge, viewport.height - anchor.top + gap) + 'px' : 'auto',
  }
}
