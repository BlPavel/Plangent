import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { BranchQuestion, BranchQuestionMessage, BranchRef, BranchReview, MrInfo, MrList, Remark, ReviewThread } from '../types'

export type ReviewPanel = 'overview' | 'remarks' | 'agent' | 'threads'
export interface MrFilters {
  /** all: every open MR; mine: written by me; review: I am a reviewer; unapproved: without my approval. */
  who: 'all' | 'mine' | 'review' | 'unapproved'
  /** Show only MRs with fewer approvals than this; 0 — any. */
  below: number
  search: string
}

/** Everything the Ревью tab shows for one project or group; the tab itself is unmounted when the user leaves it. */
export interface ReviewScreen {
  memberId: string
  /** The entry screen: open merge requests or a pair of branches picked by hand. */
  entry: 'mr' | 'branch'
  mrs: MrList | null
  filters: MrFilters
  list: BranchRef[]
  branch: string
  baseRef: string
  detail: BranchReview | undefined
  /** The hosting's view of the open review's MR; null for a branch review. */
  info: MrInfo | null
  remarks: Remark[]
  path: string
  panel: ReviewPanel
  /** Only files the author changed after the last publication. */
  onlyChanged: boolean
  questions: BranchQuestion[]
  messages: BranchQuestionMessage[]
  /** The agent session of the open review (whole-branch thread of the current head). */
  thread: ReviewThread | null
}

export const useBranchReviewStore = defineStore('branch-review', () => {
  const screens = reactive<Record<string, ReviewScreen>>({})
  function of(key: string): ReviewScreen {
    if (!screens[key]) screens[key] = {
      memberId: '', entry: 'mr', mrs: null, filters: { who: 'all', below: 0, search: '' }, list: [], branch: '', baseRef: '',
      detail: undefined, info: null, remarks: [], path: '', panel: 'overview', onlyChanged: false, questions: [], messages: [], thread: null,
    }
    return screens[key]
  }
  return { of }
})
