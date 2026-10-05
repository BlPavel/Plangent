import type Database from 'better-sqlite3';
import type { AgentSession } from '../agent-sessions/types';
import type { CodeReview, CodeReviewItem } from '../../models/code-review';
import { snapshot } from '../code/git';
import { CodeError } from '../code/files';
import { createReviewStore } from './store';

function count(n: number, one: string, few: string, many: string): string {
  const word = n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
  return `${n} ${word}`;
}

/** What the next batch carries: new drafts and threads with the developer's queued replies. */
export function pendingItems(store: ReturnType<typeof createReviewStore>, reviewId: string): CodeReviewItem[] {
  const queued = new Set(store.listMessages(reviewId).filter(m => m.author === 'developer' && !m.sent).map(m => m.item_id));
  return store.listItems(reviewId).filter(item => (item.status === 'draft' && !item.outdated) || queued.has(item.id));
}

/**
 * Capture outside the transaction; caller holds the project lifecycle lock. Without `itemIds` the
 * round takes everything pending; «Отправить сейчас» passes one thread.
 */
export async function captureRound(db: Database.Database, review: CodeReview, session: AgentSession,
  root: string, ensureCurrent: () => Promise<void>, itemIds?: string[]) {
  const store = createReviewStore(db);
  const pending = pendingItems(store, review.id);
  if (itemIds && itemIds.some(id => !pending.some(item => item.id === id)))
    throw new CodeError('Nothing to send for this item: write a reply first', 409);
  const chosen = itemIds ? pending.filter(item => itemIds.includes(item.id)) : pending;
  if (!chosen.length) throw new CodeError('Nothing to send', 409);
  const tree = await snapshot(root);
  await ensureCurrent();
  return db.transaction(() => {
    const round = store.createRound({ review_id: review.id, snapshot_tree: tree ?? '', session_id: session.id });
    const items = chosen.map(item => {
      store.sendMessages(item.id, round.id);
      return store.updateItem(item.id, { round_id: round.id, status: 'sent', closed: false })!;
    });
    const fresh = chosen.filter(item => item.status === 'draft').length;
    const replies = items.length - fresh;
    // The items themselves travel through get_review; the chat only announces the round.
    const counts = [fresh && count(fresh, 'новый пункт', 'новых пункта', 'новых пунктов'), replies && count(replies, 'ответ в обсуждении', 'ответа в обсуждениях', 'ответов в обсуждениях')].filter(Boolean);
    const text = `Ревью #${review.number}, раунд ${round.n}: ${counts.join(' и ')}. Возьми их через get_review.`;
    return { round, items, text, previous: chosen };
  })();
}
