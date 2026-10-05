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

/** Items the developer can hand to an agent: drafts, answered questions to implement, disputed items to insist on. */
export function sendable(item: CodeReviewItem): boolean {
  return !item.outdated && (item.status === 'draft' || item.status === 'needs_decision' || (item.status === 'answered' && item.kind === 'question'));
}

/**
 * Capture outside the transaction; caller holds the project lifecycle lock. Without `itemIds` the
 * round takes all drafts. An answered question sent again becomes a fix: sending it is the agreement.
 */
export async function captureRound(db: Database.Database, review: CodeReview, session: AgentSession,
  root: string, ensureCurrent: () => Promise<void>, itemIds?: string[]) {
  const store = createReviewStore(db);
  const all = store.listItems(review.id);
  if (itemIds && itemIds.some(id => !all.some(item => item.id === id && sendable(item))))
    throw new CodeError('Only drafts, answered questions and disputed items can be sent', 409);
  const drafts = itemIds ? all.filter(item => itemIds.includes(item.id)) : all.filter(item => item.status === 'draft');
  if (!drafts.length) throw new CodeError('No draft items', 409);
  const tree = await snapshot(root);
  await ensureCurrent();
  return db.transaction(() => {
    const round = store.createRound({ review_id: review.id, snapshot_tree: tree ?? '', session_id: session.id });
    const items = drafts.map(item => store.updateItem(item.id, { round_id: round.id, status: 'sent', ...(item.status === 'answered' ? { kind: 'fix' as const } : {}) })!);
    const fixes = items.filter(item => item.kind === 'fix').length;
    const questions = items.length - fixes;
    // The items themselves travel through get_review; the chat only announces the round.
    const counts = [fixes && count(fixes, 'замечание', 'замечания', 'замечаний'), questions && count(questions, 'вопрос', 'вопроса', 'вопросов')].filter(Boolean);
    const text = `Ревью #${review.number}, раунд ${round.n}: ${counts.join(' и ')}. Возьми их через get_review.`;
    return { round, items, text, previous: drafts };
  })();
}
