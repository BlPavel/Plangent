import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ComposerDraft {
  text: string
  attachments: { name: string; preview?: string; block: Record<string, unknown> }[]
  mentions: Map<string, string>
}

export function emptyDraft(text = ''): ComposerDraft {
  return { text, attachments: [], mentions: new Map() }
}

// Kept outside the views so navigating away does not discard unsent messages.
export const useChatDraftsStore = defineStore('agent-chat-drafts', () => {
  const drafts = ref<Record<string, ComposerDraft>>({})
  const selectedByProject = ref<Record<string, string>>({})

  function get(key: string, initialText = '') {
    if (!drafts.value[key]) drafts.value[key] = emptyDraft(initialText)
    return drafts.value[key]
  }

  function removeSession(id: string) {
    delete drafts.value[`session:${id}`]
    for (const projectId of Object.keys(selectedByProject.value)) {
      if (selectedByProject.value[projectId] === id) delete selectedByProject.value[projectId]
    }
  }

  return { drafts, selectedByProject, get, removeSession }
})
