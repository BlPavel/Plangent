import { computed, type ComputedRef } from 'vue'
import { useBranchReviewStore } from '../stores/review'

/** What a discussion is about: one of the review's remarks or a colleague's GitLab thread. */
export interface DiscussionLink { remarkId?: string; threadId?: string }
export type DiscussionStage = '' | 'queued' | 'waiting' | 'answered'

/**
 * The conversation with the agent about a remark or a thread is one question thread of the review,
 * linked to it: messages the developer writes wait in the queue until they are sent in a batch.
 */
export function useDiscussion(screenKey: string, link: () => DiscussionLink) {
  const screen = useBranchReviewStore().of(screenKey)
  const question = computed(() => {
    const { remarkId, threadId } = link()
    return screen.questions.find(q => remarkId ? q.remark_id === remarkId : !!threadId && q.thread_id === threadId)
  })
  const messages = computed(() => question.value ? screen.messages.filter(m => m.question_id === question.value!.id) : [])
  const queued = computed(() => messages.value.filter(m => m.author === 'developer' && !m.sent))
  /** Where the conversation stands: something waits to be sent, the agent owes an answer, or the agent has answered. */
  const stage: ComputedRef<DiscussionStage> = computed(() => {
    const last = messages.value.at(-1)
    if (!last) return ''
    if (queued.value.length) return 'queued'
    return last.author === 'agent' ? 'answered' : 'waiting'
  })
  return { screen, question, messages, queued, stage }
}
