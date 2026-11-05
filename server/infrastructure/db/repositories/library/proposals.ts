import { getDb } from '../../schema';

export function getProposalRow(id: string) { return getDb().prepare('SELECT * FROM library_proposals WHERE id=?').get(id); }
export function listProposalRows(filters: { projectId?: string; sessionId?: string }) {
  const conditions: string[] = [], params: string[] = [];
  if (filters.projectId) { conditions.push('project_id=?'); params.push(filters.projectId); }
  if (filters.sessionId) { conditions.push('session_id=?'); params.push(filters.sessionId); }
  return getDb().prepare('SELECT * FROM library_proposals' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') + ' ORDER BY created_at, rowid').all(...params);
}
export function insertProposal(id: string, projectId: string, sessionId: string, data: string) {
  getDb().prepare("INSERT INTO library_proposals(id,project_id,session_id,status,data) VALUES (?,?,?,'pending',?)").run(id, projectId, sessionId, data);
}
export function updateProposalStatus(id: string, status: string, appliedId?: string) {
  getDb().prepare("UPDATE library_proposals SET status=?, applied_item_id=?, updated_at=datetime('now') WHERE id=?").run(status, appliedId ?? null, id);
}
export function libraryTransaction<T>(fn: () => T) { return getDb().transaction(fn); }
