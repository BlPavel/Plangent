export type CodeReviewStatus = 'open' | 'closed' | 'abandoned';
export type CodeReviewOrigin = 'project' | 'task';
export type CodeReviewItemStatus = 'draft' | 'sent' | 'done' | 'answered' | 'needs_decision' | 'rejected';

export interface CodeReview {
  id: string;
  /** Per-project display number: «Ревью #12». */
  number: number;
  project_id: string;
  branch: string | null;
  head_commit: string | null;
  status: CodeReviewStatus;
  origin: CodeReviewOrigin;
  origin_id: string;
  head_start: string;
  head_last: string;
  head_end: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface CodeReviewRound {
  id: string;
  review_id: string;
  n: number;
  snapshot_tree: string;
  // Agent sessions have their own lifecycle; deleting a chat must preserve review history.
  session_id: string | null;
  sent_at: string;
}

export interface CodeReviewItem {
  id: string;
  review_id: string;
  round_id: string | null;
  author: 'developer' | 'agent';
  scope: 'line' | 'file' | 'general';
  file: string | null;
  line_start: number | null;
  line_end: number | null;
  side: 'new' | 'old';
  kind: 'fix' | 'question';
  text: string;
  refs: string[];
  code_snippet: string;
  status: CodeReviewItemStatus;
  answer: string | null;
  outdated: boolean;
  /** The developer closed the thread (accepted, answered or rejected); writing to it reopens it. */
  closed: boolean;
  carried_from_item_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Developer: free text or «Сделать так» (implement, optionally a chosen option). Agent: one reply of a typed kind. */
export type CodeReviewMessageKind = 'text' | 'implement' | 'answer' | 'options' | 'questions' | 'change' | 'disagree';

/** One message in an item's thread. Developer messages wait (sent=false) until the next batch is sent. */
export interface CodeReviewMessage {
  id: string;
  item_id: string;
  author: 'developer' | 'agent';
  kind: CodeReviewMessageKind;
  text: string;
  /** Choices offered by the agent; `recommended` marks its pick. */
  options: { label: string; recommended?: boolean }[];
  /** Index of the option the developer chose («Сделать так»). */
  choice: number | null;
  /** Files the agent reports it changed for this item. */
  files: string[];
  round_id: string | null;
  sent: boolean;
  created_at: string;
}

export interface CodeReviewFileView {
  review_id: string;
  path: string;
  content_hash: string;
  invalidated: boolean;
  viewed_at: string;
}

export type CreateCodeReview = Pick<CodeReview, 'project_id' | 'branch' | 'head_start' | 'origin' | 'origin_id'>
  & Partial<Pick<CodeReview, 'head_commit'>>;
export type UpdateCodeReview = Partial<Pick<CodeReview, 'status' | 'head_end'>>;
export type CreateCodeReviewRound = Pick<CodeReviewRound, 'review_id' | 'snapshot_tree'>
  & Partial<Pick<CodeReviewRound, 'session_id'>>;
export type UpdateCodeReviewItem = Partial<Omit<CodeReviewItem, 'id' | 'review_id' | 'created_at' | 'updated_at'>>;
export type CreateCodeReviewItem = Pick<CodeReviewItem, 'review_id' | 'scope' | 'kind' | 'text'>
  & UpdateCodeReviewItem;
