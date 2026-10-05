import type Database from 'better-sqlite3';
import type { AgentSession } from '../agent-sessions/types';
import type { CodeReview } from '../../models/code-review';
import { snapshot } from '../code/git';
import { CodeError } from '../code/files';
import { createReviewStore } from './store';

/** Capture outside the transaction; caller holds the project lifecycle lock. */
export async function captureRound(db: Database.Database, review: CodeReview, session: AgentSession,
  root: string, ensureCurrent: () => Promise<void>) {
  const store = createReviewStore(db);
  const drafts = store.listItems(review.id).filter(item => item.status === 'draft');
  if (!drafts.length) throw new CodeError('No draft items', 409);
  const tree = await snapshot(root);
  await ensureCurrent();
  return db.transaction(() => {
    const round = store.createRound({ review_id: review.id, snapshot_tree: tree ?? '', session_id: session.id });
    const items = drafts.map(item => store.updateItem(item.id, { round_id: round.id, status: 'sent' })!);
    const fixes = items.filter(item => item.kind === 'fix').length;
    const questions = items.length - fixes;
    const text = `Ревью #${review.number}, раунд ${round.n}: ${fixes} замечаний, ${questions} вопросов\n`
      + items.map(item => `- ${item.kind === 'question' ? '?' : '!'} [${item.id}] ${item.file ?? 'Общее'}: ${item.text.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n')
      + '\nПолные данные получите через MCP get_review.';
    return { round, items, text };
  })();
}
