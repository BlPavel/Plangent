import { computed } from 'vue'
import { useChatStore, type ChatSession } from '@features/agent-chat'
import { useCodeStore } from '../stores/code'
import type { CodeReviewItem } from '../types'

export interface ReviewChat { session: ChatSession; pending: number; round: number }

/** Statuses in which a chat is busy with a turn: the review cannot take a new round meanwhile. */
export const BUSY_STATUSES = ['starting', 'thinking', 'waiting']

/** Chats of the open review, in the order of their first round; a chat can serve several rounds. */
export function useReviewChats() {
  const chats = useChatStore()
  const store = useCodeStore()
  const list = computed<ReviewChat[]>(() => {
    const result: ReviewChat[] = []
    for (const round of store.rounds) {
      if (!round.session_id || result.some(c => c.session.id === round.session_id)) continue
      const session = chats.sessions.find(s => s.id === round.session_id && s.role === 'code-fixer')
      if (!session) continue
      const mine = store.rounds.filter(r => r.session_id === session.id)
      const ids = new Set(mine.map(r => r.id))
      result.push({ session, round: Math.max(...mine.map(r => r.n)),
        pending: store.items.filter(i => i.round_id && ids.has(i.round_id) && (i.status === 'sent' || i.status === 'needs_decision')).length })
    }
    return result
  })
  /** The chat of the latest round: where «Отправить» goes by default. */
  const latest = computed(() => {
    const round = [...store.rounds].reverse().find(r => r.session_id && list.value.some(c => c.session.id === r.session_id))
    return list.value.find(c => c.session.id === round?.session_id) ?? null
  })
  /** The chat that handled an item, if it still exists. */
  const chatOf = (item: CodeReviewItem) => {
    const session = store.rounds.find(r => r.id === item.round_id)?.session_id
    return list.value.find(c => c.session.id === session) ?? null
  }
  return { list, latest, chatOf }
}
