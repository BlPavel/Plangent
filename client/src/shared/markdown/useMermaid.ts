import { onBeforeUnmount, onMounted, watch, nextTick, type Ref } from 'vue'

type Mermaid = typeof import('mermaid').default
let loaded: Promise<Mermaid> | undefined
let counter = 0

/** The library is loaded when the first diagram appears, not with the app. */
const load = () => loaded ??= import('mermaid').then(module => module.default)
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function initialize(mermaid: Mermaid) {
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base',
    themeVariables: {
      background: css('--bg'), primaryColor: css('--bg3'), primaryTextColor: css('--text'),
      primaryBorderColor: css('--border-strong'), lineColor: css('--text-muted'),
      secondaryColor: css('--bg2'), tertiaryColor: css('--bg2'), fontFamily: css('--font-sans'),
    },
  })
}
/** Syntax errors stay beside the source: the block keeps its text and gets a message, the rest of the document is untouched. */
async function draw(block: HTMLElement, mermaid: Mermaid) {
  const source = block.querySelector('code')?.textContent ?? ''
  block.querySelector('.mermaid-error')?.remove()
  try {
    const { svg } = await mermaid.render('mermaid-' + ++counter, source)
    block.dataset.mermaid = 'done'
    block.innerHTML = svg
    block.dataset.source = source
  } catch (error) {
    document.getElementById('dmermaid-' + counter)?.remove()
    block.dataset.mermaid = 'error'
    const note = document.createElement('p')
    note.className = 'mermaid-error'
    note.setAttribute('role', 'alert')
    note.textContent = 'Ошибка схемы Mermaid: ' + (error instanceof Error ? error.message : String(error)).split('\n')[0]
    block.append(note)
  }
}
/** Replaces mermaid blocks inside `host` with diagrams after every render, and redraws them when the theme changes. */
export function useMermaid(host: Ref<HTMLElement | undefined>, source: () => string, ready: () => boolean) {
  let observer: MutationObserver | undefined
  let generation = 0
  // Only a document with a diagram follows the theme.
  function watchTheme() {
    if (observer || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver(() => void run(true))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  }
  async function run(redraw = false) {
    const el = host.value
    if (!el || !ready()) return
    const blocks = Array.from(el.querySelectorAll<HTMLElement>('.mermaid-block')).filter(block => redraw ? block.dataset.mermaid === 'done' || block.dataset.mermaid === 'error' : block.dataset.mermaid === '')
    if (!blocks.length) return
    const mine = ++generation
    const mermaid = await load().catch(() => undefined)
    if (!mermaid || mine !== generation) return
    initialize(mermaid)
    watchTheme()
    for (const block of blocks) {
      if (!block.isConnected) continue
      if (redraw && block.dataset.source) {
        block.innerHTML = '<pre><code></code></pre>'
        block.querySelector('code')!.textContent = block.dataset.source
      }
      await draw(block, mermaid)
    }
  }
  watch(source, () => { void nextTick(() => run()) }, { flush: 'post' })
  watch(ready, now => { if (now) void nextTick(() => run()) })
  onMounted(() => void run())
  onBeforeUnmount(() => observer?.disconnect())
}
