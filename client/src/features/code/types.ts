export type { RepositoryInfo, GitChange, TreeEntry, LineStat, CodeFile, DiffOptions, SearchOptions, SearchEvent, ReviewDraft, DraftPatch, ReviewAttention, ReviewDetail, CurrentReview, BaseChanges, ReviewHistory, ExternalNote, ExternalThread, ExternalThreads, CodeReview, CodeReviewItem, CodeReviewMessage, CodeReviewRound, CodeReviewFileView } from '@contracts';
/** Where a GitLab thread card sends its actions: the Код tab's own MR by default, or another MR (the Ревью tab). */
export interface ExternalThreadActions {
  reply(discussion: string, body: string): Promise<unknown>
  resolve(discussion: string, resolved: boolean): Promise<unknown>
  editNote(discussion: string, note: number, body: string): Promise<unknown>
  deleteNote(discussion: string, note: number): Promise<unknown>
}
