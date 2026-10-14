import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { BranchQuestion, BranchQuestionMessage, BranchRef, BranchReview, ReviewThread } from '../types'

/** Everything the Ревью tab shows for one project or group; the tab itself is unmounted when the user leaves it. */
export interface ReviewScreen {
  memberId: string
  list: BranchRef[]
  branch: string
  baseRef: string
  detail: BranchReview | undefined
  path: string
  questions: BranchQuestion[]
  messages: BranchQuestionMessage[]
  /** The agent session of the open review (whole-branch thread of the current head). */
  thread: ReviewThread | null
}

export const useBranchReviewStore = defineStore('branch-review', () => {
  const screens = reactive<Record<string, ReviewScreen>>({})
  function of(key: string): ReviewScreen {
    if (!screens[key]) screens[key] = { memberId: '', list: [], branch: '', baseRef: '', detail: undefined, path: '', questions: [], messages: [], thread: null }
    return screens[key]
  }
  return { of }
})
