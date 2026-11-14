import { getDb } from '../../schema';

export const workEntryCodeReviewItem = (...params: unknown[]) => getDb().prepare(`SELECT count(*) AS n FROM code_review_item i JOIN code_review r ON r.id=i.review_id
    WHERE i.origin_id=? AND i.closed=0 AND r.status='open'`).get(...params);
