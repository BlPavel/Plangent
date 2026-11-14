import { useDraftsStore } from '@core/stores/drafts'
import type { CodeReviewItem } from '../types'
import type { ThreadState } from './thread'

const key = (item: CodeReviewItem) => `code-review:${item.review_id}:accepted:${item.id}`
export const isAccepted = (item: CodeReviewItem) => useDraftsStore().drafts[key(item)] === true
export const setAccepted = (item: CodeReviewItem, value: boolean) => { useDraftsStore().drafts[key(item)] = value }

/** A draft the review agent wrote waits for the developer: it goes out with «Отправить» only once accepted or turned into a question. */
export const awaitsDecision = (item: CodeReviewItem, state: ThreadState) => item.author === 'agent' && state === 'draft' && !isAccepted(item)
/** What «Отправить» carries: new drafts (the agent's only when accepted) and threads with queued replies. */
export const isSendable = (item: CodeReviewItem, state: ThreadState) => !item.outdated && ['draft', 'queued'].includes(state) && !awaitsDecision(item, state)
