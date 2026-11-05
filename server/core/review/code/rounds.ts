import { pendingThreads } from '../kernel';
import type { createCodeReviewRepository } from '../../../infrastructure/db/repositories/review/code/service-repository';
import type { AgentSession } from '../../agents';
import type { CodeReview, CodeReviewItem } from '../../../models/code-review';
import { snapshot } from '../../../infrastructure/git/read';
import { DomainError } from '../../../models/domain-error';
import { createReviewStore } from '../../../infrastructure/db/repositories/review/code';

/** What the next batch carries: new drafts and threads with the developer's queued replies. */
export function pendingItems(store: ReturnType<typeof createReviewStore>, reviewId: string): CodeReviewItem[] {
  const messages = store.listMessages(reviewId);
  return pendingThreads(store.listItems(reviewId), item => messages.filter(m => m.item_id === item.id), item => item.status === 'draft' && !item.outdated);
}

/**
 * Capture outside the transaction; caller holds the project lifecycle lock. Without `itemIds` the
 * round takes everything pending; «Отправить сейчас» passes one thread.
 */
export async function captureRound(records: ReturnType<typeof createCodeReviewRepository>, review: CodeReview, session: AgentSession,
  root: string, ensureCurrent: () => Promise<void>, itemIds?: string[]) {
  const { store } = records;
  const pending = pendingItems(store, review.id);
  if (itemIds && itemIds.some(id => !pending.some(item => item.id === id)))
    throw new DomainError('Nothing to send for this item: write a reply first', 409);
  const chosen = itemIds ? pending.filter(item => itemIds.includes(item.id)) : pending;
  if (!chosen.length) throw new DomainError('Nothing to send', 409);
  const tree = await snapshot(root);
  await ensureCurrent();
  return records.transaction(() => {
    const round = store.createRound({ review_id: review.id, snapshot_tree: tree ?? '', session_id: session.id });
    const items = chosen.map(item => {
      store.sendMessages(item.id, round.id);
      return store.updateItem(item.id, { round_id: round.id, status: 'sent', closed: false })!;
    });
    const fresh = chosen.filter(item => item.status === 'draft').length;
    const replies = items.length - fresh;
    // The items themselves travel through get_review; the chat only announces the round.
    const text = `Review #${review.number}, round ${round.n}: ${fresh} new items and ${replies} discussion replies. Call get_review to retrieve them.`;
    return { round, items, text, previous: chosen };
  });
}
