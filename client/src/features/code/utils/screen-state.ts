import type { CurrentReview, ReviewDetail } from '../types'

/**
 * The screen is always the live repository plus the open review of the current branch (if any).
 * Which of these the developer sees is one value, computed here from server data; templates only switch on it.
 *
 * - `clean`            no changes, no review: «Нет изменений относительно a1b2c3», recent reviews on the right
 * - `changes`          changes, no review yet: the review starts by itself with the first draft or «Просмотрено»
 * - `reviewing`        the review is open, nothing sent yet
 * - `agent-working`    a code-fixer chat of the review is running: sending is blocked, drafts are not
 * - `agent-replied`    at least one round came back: item statuses, base «Изменения агента»
 * - `committed`        HEAD moved but changes remain (also when the developer returned with new edits on top of
 *                      a fully committed review: the data, banner and Diff against the new HEAD are the same)
 * - `all-committed`    HEAD moved and the worktree is clean: the review summary instead of emptiness
 * - `history`          a finished, abandoned or other-branch review is opened read-only
 */
export type ScreenState = 'clean' | 'changes' | 'reviewing' | 'agent-working' | 'agent-replied' | 'committed' | 'all-committed' | 'history'

export interface ScreenInput {
  /** Number of files that differ from HEAD. */
  changes: number
  current: Pick<CurrentReview, 'review' | 'rounds' | 'agent_working' | 'head_changed'> | null
  opened: Pick<ReviewDetail, 'review'> | null
}

export function screenState({ changes, current, opened }: ScreenInput): ScreenState {
  if (opened) return 'history'
  const review = current?.review
  if (!review) return changes ? 'changes' : 'clean'
  // A running agent comes first: finishing is blocked meanwhile, and the commit banner would only offer what cannot be done.
  if (current.agent_working) return 'agent-working'
  if (current.head_changed) return changes ? 'committed' : 'all-committed'
  return current.rounds.length ? 'agent-replied' : 'reviewing'
}

const PENDING = ['draft', 'sent', 'needs_decision']
/** Items that keep a review from being closed without a decision about them. */
export const countUnresolved = (items: { status: string }[]) => items.filter(item => PENDING.includes(item.status)).length
