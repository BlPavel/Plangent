import { defineStore } from 'pinia'
import type { MentionDrag } from '../utils/mention-drag'

/** A message field which can take a mention; it reports itself for the time it is mounted. */
export interface ComposerTarget {
  projectId: () => string
  workspaceId: () => string | null
  visible: () => boolean
  /** Inserts at the caret through the field's own draft; false when nothing was inserted. */
  insert: (mention: MentionDrag) => Promise<boolean>
  /** Last time something was typed in the field: 0 — never. */
  typedAt: number
}

/** A screen which can show its chat field (unfold the chat, open the new message panel) when none is visible. */
export interface ComposerReveal {
  projectId: () => string
  workspaceId: () => string | null
  /** Only the screen the user looks at: tabs kept mounted are hidden. */
  visible: () => boolean
  show: () => void | Promise<void>
}

const sameWorkspace = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Where «В чат» puts a mention: the visible field where the user typed last; else the screen shows a field and
 * the mention begins its draft. Drafts take the text, so hidden chats and unstarted conversations lose nothing.
 */
export const useComposerTargetsStore = defineStore('composer-targets', () => {
  const targets = new Set<ComposerTarget>()
  const reveals = new Set<ComposerReveal>()
  let clock = 0

  function register(target: Omit<ComposerTarget, 'typedAt'>): ComposerTarget {
    const entry: ComposerTarget = { ...target, typedAt: 0 }
    targets.add(entry)
    return entry
  }
  /** Marks the field as the one typed in last. */
  function touch(target: ComposerTarget) { target.typedAt = ++clock }
  function unregister(target: ComposerTarget) { targets.delete(target) }
  function addReveal(reveal: ComposerReveal) {
    reveals.add(reveal)
    return () => { reveals.delete(reveal) }
  }

  function best(mention: MentionDrag): ComposerTarget | null {
    let found: ComposerTarget | null = null
    for (const target of targets) {
      if (target.projectId() !== mention.projectId || !sameWorkspace(target.workspaceId(), mention.workspaceId) || !target.visible()) continue
      if (!found || target.typedAt > found.typedAt) found = target
    }
    return found
  }
  async function appeared(mention: MentionDrag) {
    for (let waited = 0; waited <= 400; waited += 40) {
      const target = best(mention)
      if (target) return target
      await pause(40)
    }
    return best(mention)
  }

  /** False when the screen has no field to show; the caller says so. */
  async function insertMention(mention: MentionDrag): Promise<boolean> {
    // A second pass lets a screen which switches to another tab show the field of that tab.
    for (let pass = 0; pass < 3; pass++) {
      let target = best(mention)
      if (!target) {
        const shown = [...reveals].filter(r => r.projectId() === mention.projectId && sameWorkspace(r.workspaceId(), mention.workspaceId) && r.visible())
        if (!shown.length) return false
        // Inner screens (registered first) go before the one around them, which only switches tabs.
        for (const reveal of shown) {
          await reveal.show()
          target = await appeared(mention)
          if (target) break
        }
      }
      if (target) return target.insert(mention)
    }
    return false
  }

  return { register, unregister, touch, addReveal, insertMention }
})
