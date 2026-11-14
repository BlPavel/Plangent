import { getDb } from '../../../schema';

export const resetInterruptedDocsSyncsUpdateProjects = (...params: unknown[]) => getDb().prepare("UPDATE projects SET sync_status='cancelled',sync_stats=? WHERE source_type='docs' AND sync_status='running'").run(...params);
export const syncDocsSourceUpdateProjects = (...params: unknown[]) => getDb().prepare("UPDATE projects SET sync_status='running' WHERE id=?").run(...params);
export const syncDocsSourceUpdateProjects2 = (...params: unknown[]) => getDb().prepare('UPDATE projects SET sync_status=?,last_sync_at=?,sync_stats=?,repo_path=? WHERE id=?').run(...params);
export const syncDocsSourceUpdateProjects3 = (...params: unknown[]) => getDb().prepare('UPDATE projects SET sync_status=?,sync_stats=? WHERE id=?').run(...params);
