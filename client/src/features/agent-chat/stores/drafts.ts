import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useDraftsStore } from '@core/stores/drafts'

export interface ComposerDraft {
  touched: boolean
  text: string
  attachments: { name: string; preview?: string; block: NonNullable<import('@contracts').AgentSessionsPOSTIdActionBody['content']>[number] }[]
  mentions: Map<string, string>
}

export function emptyDraft(text = ''): ComposerDraft {
  return { touched: false, text, attachments: [], mentions: new Map() }
}

// Kept outside the views so navigating away does not discard unsent messages.
export const useChatDraftsStore = defineStore('agent-chat-drafts', () => {
  const selectedByProject = ref<Record<string, string>>({})


  function removeSession(id: string) {
    useDraftsStore().clear(`session:${id}`)
    useDraftsStore().clearPrefix(`session:${id}:`)
    for (const projectId of Object.keys(selectedByProject.value)) {
      if (selectedByProject.value[projectId] === id) delete selectedByProject.value[projectId]
    }
  }

  return { selectedByProject, removeSession }
})
