import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../../infrastructure/db/schema';
import type {
  CodeReview, CodeReviewRound, CodeReviewItem, CodeReviewFileView, CodeReviewMessage,
  CreateCodeReview, UpdateCodeReview, CreateCodeReviewRound,
  CreateCodeReviewItem, UpdateCodeReviewItem,
} from '../../models/code-review';

type ItemRow = Omit<CodeReviewItem, 'refs' | 'outdated' | 'closed'> & { refs: string; outdated: number; closed: number };
type MessageRow = Omit<CodeReviewMessage, 'options' | 'files' | 'sent'> & { options: string; files: string; sent: number };

function parseItem(row: ItemRow): CodeReviewItem {
  return { ...row, refs: JSON.parse(row.refs), outdated: row.outdated === 1, closed: row.closed === 1 };
}
function parseMessage(row: MessageRow): CodeReviewMessage {
  return { ...row, options: JSON.parse(row.options), files: JSON.parse(row.files), sent: row.sent === 1 };
}
export type CreateCodeReviewMessage = Pick<CodeReviewMessage, 'item_id' | 'author' | 'kind' | 'text'>
  & Partial<Pick<CodeReviewMessage, 'options' | 'choice' | 'files' | 'round_id' | 'sent'>>;

function encodeRefs(refs: string[]): string {
  if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string')) {
    throw new Error('Review refs must be an array of strings');
  }
  return JSON.stringify(refs);
}

/** Storage only: round sending, lifecycle decisions and agent orchestration belong to the service. */
export function createReviewStore(db: Database.Database = getDb()) {
  function getReview(id: string): CodeReview | null {
    return db.prepare('SELECT * FROM code_review WHERE id=?').get(id) as CodeReview | undefined ?? null;
  }

  function listReviews(project_id: string, status?: CodeReview['status']): CodeReview[] {
    return (status === undefined
      ? db.prepare('SELECT * FROM code_review WHERE project_id=? ORDER BY created_at DESC, id').all(project_id)
      : db.prepare('SELECT * FROM code_review WHERE project_id=? AND status=? ORDER BY created_at DESC, id').all(project_id, status)
    ) as CodeReview[];
  }

  function getOpenReview(project_id: string, branch: string | null, head_commit?: string): CodeReview | null {
    return (branch === null
      ? db.prepare("SELECT * FROM code_review WHERE project_id=? AND branch IS NULL AND head_commit IS ? AND status='open'").get(project_id, head_commit ?? null)
      : db.prepare("SELECT * FROM code_review WHERE project_id=? AND branch=? AND status='open'").get(project_id, branch)
    ) as CodeReview | undefined ?? null;
  }

  function createReview(data: CreateCodeReview): CodeReview {
    const id = randomUUID();
    db.prepare(`INSERT INTO code_review(id,project_id,branch,head_commit,origin,origin_id,head_start,head_last,number)
      VALUES (?,?,?,?,?,?,?,?,(SELECT coalesce(max(number),0)+1 FROM code_review WHERE project_id=?))`).run(id, data.project_id, data.branch, data.head_commit ?? null,
        data.origin, data.origin_id, data.head_start, data.head_start, data.project_id);
    return getReview(id)!;
  }

  function updateReview(id: string, data: UpdateCodeReview): CodeReview | null {
    return db.transaction(() => {
      const current = getReview(id);
      if (!current) return null;
      const status = data.status ?? current.status;
      const head_end = data.head_end === undefined ? current.head_end : data.head_end;
      db.prepare(`UPDATE code_review SET status=?,head_end=?,
        closed_at=CASE WHEN ?='open' THEN NULL ELSE coalesce(closed_at,datetime('now')) END WHERE id=?`)
        .run(status, head_end, status, id);
      return getReview(id);
    })();
  }

  function deleteReview(id: string): boolean {
    return db.prepare('DELETE FROM code_review WHERE id=?').run(id).changes > 0;
  }

  function getRound(id: string): CodeReviewRound | null {
    return db.prepare('SELECT * FROM code_review_round WHERE id=?').get(id) as CodeReviewRound | undefined ?? null;
  }

  function listRounds(review_id: string): CodeReviewRound[] {
    return db.prepare('SELECT * FROM code_review_round WHERE review_id=? ORDER BY n').all(review_id) as CodeReviewRound[];
  }

  function createRound(data: CreateCodeReviewRound): CodeReviewRound {
    return db.transaction(() => {
      const id = randomUUID();
      const { n } = db.prepare('SELECT coalesce(max(n),0)+1 AS n FROM code_review_round WHERE review_id=?')
        .get(data.review_id) as { n: number };
      db.prepare('INSERT INTO code_review_round(id,review_id,n,snapshot_tree,session_id) VALUES (?,?,?,?,?)')
        .run(id, data.review_id, n, data.snapshot_tree, data.session_id ?? null);
      return getRound(id)!;
    })();
  }

  function updateRound(id: string, data: Partial<Pick<CodeReviewRound, 'session_id'>>): CodeReviewRound | null {
    if (data.session_id !== undefined) {
      db.prepare('UPDATE code_review_round SET session_id=? WHERE id=?').run(data.session_id, id);
    }
    return getRound(id);
  }

  function deleteRound(id: string): boolean {
    return db.prepare('DELETE FROM code_review_round WHERE id=?').run(id).changes > 0;
  }

  function getItem(id: string): CodeReviewItem | null {
    const row = db.prepare('SELECT * FROM code_review_item WHERE id=?').get(id) as ItemRow | undefined;
    return row ? parseItem(row) : null;
  }

  // undefined = all items, null = drafts, string = items belonging to that round.
  function listItems(review_id: string, round_id?: string | null): CodeReviewItem[] {
    const rows = (round_id === undefined
      ? db.prepare('SELECT * FROM code_review_item WHERE review_id=? ORDER BY created_at,id').all(review_id)
      : db.prepare('SELECT * FROM code_review_item WHERE review_id=? AND round_id IS ? ORDER BY created_at,id').all(review_id, round_id)
    ) as ItemRow[];
    return rows.map(parseItem);
  }

  function checkCarriedItem(review_id: string, carried_id: string | null | undefined): void {
    if (!carried_id) return;
    const sourceItem = getItem(carried_id);
    const source = sourceItem && getReview(sourceItem.review_id);
    const target = getReview(review_id);
    if (source?.id === review_id) return;
    if (!source || !target || source.status !== 'closed' || source.project_id !== target.project_id
      || source.branch !== target.branch
      || (source.branch === null && source.head_commit !== target.head_commit)) {
      throw new Error('Carried item must belong to the same review or a closed review of the same branch');
    }
  }

  function createItem(data: CreateCodeReviewItem): CodeReviewItem {
    return db.transaction(() => {
      checkCarriedItem(data.review_id, data.carried_from_item_id);
      const id = randomUUID();
      db.prepare(`INSERT INTO code_review_item(
        id,review_id,round_id,author,scope,file,line_start,line_end,side,kind,text,refs,
        code_snippet,status,answer,outdated,carried_from_item_id,closed
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, data.review_id, data.round_id ?? null, data.author ?? 'developer',
        data.scope, data.file ?? null, data.line_start ?? null, data.line_end ?? null,
        data.side ?? 'new', data.kind, data.text, encodeRefs(data.refs ?? []),
        data.code_snippet ?? '', data.status ?? 'draft', data.answer ?? null,
        data.outdated ? 1 : 0, data.carried_from_item_id ?? null, data.closed ? 1 : 0);
      return getItem(id)!;
    })();
  }

  function updateItem(id: string, data: UpdateCodeReviewItem): CodeReviewItem | null {
    return db.transaction(() => {
      const current = getItem(id);
      if (!current) return null;
      // Only declared mutable fields enter SQL; ids and timestamps cannot be overwritten by callers.
      const u = { ...current };
      const keys = ['round_id','author','scope','file','line_start','line_end','side','kind','text',
        'refs','code_snippet','status','answer','outdated','carried_from_item_id','closed'] as const;
      for (const key of keys) {
        if (data[key] !== undefined) Object.assign(u, { [key]: data[key] });
      }
      checkCarriedItem(current.review_id, u.carried_from_item_id);
      if (u.carried_from_item_id === id) throw new Error('An item cannot carry itself');
      db.prepare(`UPDATE code_review_item SET round_id=?,author=?,scope=?,file=?,line_start=?,line_end=?,
        side=?,kind=?,text=?,refs=?,code_snippet=?,status=?,answer=?,outdated=?,carried_from_item_id=?,
        closed=?,updated_at=datetime('now') WHERE id=?`).run(
        u.round_id, u.author, u.scope, u.file, u.line_start, u.line_end, u.side,
        u.kind, u.text, encodeRefs(u.refs), u.code_snippet, u.status, u.answer,
        u.outdated ? 1 : 0, u.carried_from_item_id, u.closed ? 1 : 0, id);
      return getItem(id);
    })();
  }

  function deleteItem(id: string): boolean {
    return db.prepare('DELETE FROM code_review_item WHERE id=?').run(id).changes > 0;
  }

  /** Threads of a review (or of one item), oldest first. */
  function listMessages(review_id: string, item_id?: string): CodeReviewMessage[] {
    const rows = item_id
      ? db.prepare('SELECT * FROM code_review_message WHERE item_id=? ORDER BY created_at, rowid').all(item_id)
      : db.prepare(`SELECT m.* FROM code_review_message m JOIN code_review_item i ON i.id=m.item_id
          WHERE i.review_id=? ORDER BY m.created_at, m.rowid`).all(review_id);
    return (rows as MessageRow[]).map(parseMessage);
  }

  function getMessage(id: string): CodeReviewMessage | null {
    const row = db.prepare('SELECT * FROM code_review_message WHERE id=?').get(id) as MessageRow | undefined;
    return row ? parseMessage(row) : null;
  }

  function createMessage(data: CreateCodeReviewMessage): CodeReviewMessage {
    const id = randomUUID();
    db.prepare(`INSERT INTO code_review_message(id,item_id,author,kind,text,options,choice,files,round_id,sent)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, data.item_id, data.author, data.kind, data.text,
      JSON.stringify(data.options ?? []), data.choice ?? null, JSON.stringify(data.files ?? []), data.round_id ?? null, data.sent ? 1 : 0);
    return getMessage(id)!;
  }

  /** The developer's queued replies of an item leave with a round. */
  function sendMessages(item_id: string, round_id: string): void {
    db.prepare("UPDATE code_review_message SET sent=1, round_id=? WHERE item_id=? AND author='developer' AND sent=0").run(round_id, item_id);
  }

  /** A round that failed to reach the agent puts its replies back in the queue. */
  function unsendRound(round_id: string): void {
    db.prepare("UPDATE code_review_message SET sent=0, round_id=NULL WHERE round_id=? AND author='developer'").run(round_id);
  }

  function deleteMessage(id: string): boolean {
    return db.prepare('DELETE FROM code_review_message WHERE id=?').run(id).changes > 0;
  }

  function markFileViewed(review_id: string, path: string, content_hash: string): CodeReviewFileView {
    db.prepare(`INSERT INTO code_review_file_view(review_id,path,content_hash) VALUES (?,?,?)
      ON CONFLICT(review_id,path) DO UPDATE SET content_hash=excluded.content_hash,invalidated=0,viewed_at=datetime('now')`)
      .run(review_id, path, content_hash);
    const row = db.prepare('SELECT * FROM code_review_file_view WHERE review_id=? AND path=?')
      .get(review_id, path) as CodeReviewFileView;
    return { ...row, invalidated: Boolean(row.invalidated) };
  }

  function listFileViews(review_id: string): CodeReviewFileView[] {
    return (db.prepare('SELECT * FROM code_review_file_view WHERE review_id=? ORDER BY path')
      .all(review_id) as CodeReviewFileView[]).map(row => ({ ...row, invalidated: Boolean(row.invalidated) }));
  }

  function isFileViewed(review_id: string, path: string, content_hash: string): boolean {
    return !!db.prepare('SELECT 1 FROM code_review_file_view WHERE review_id=? AND path=? AND content_hash=? AND invalidated=0')
      .get(review_id, path, content_hash);
  }

  function deleteFileView(review_id: string, path: string): boolean {
    return db.prepare('DELETE FROM code_review_file_view WHERE review_id=? AND path=?').run(review_id, path).changes > 0;
  }

  return { getReview, listReviews, getOpenReview, createReview, updateReview, deleteReview,
    getRound, listRounds, createRound, updateRound, deleteRound,
    getItem, listItems, createItem, updateItem, deleteItem,
    listMessages, getMessage, createMessage, sendMessages, unsendRound, deleteMessage,
    markFileViewed, listFileViews, isFileViewed, deleteFileView };
}
