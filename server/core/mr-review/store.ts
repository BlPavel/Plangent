import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../../infrastructure/db/schema';
import type { MrSession, MrSnapshot, MrDraft, MrDetail } from '../../models/mr-review';
import type { DiffPosition } from '../../models/code-host';
type SessionRow = Omit<MrSession, 'snapshot' | 'previous'> & {
  snapshot: string;
  previous: string | null;
};
type DraftRow = Omit<MrDraft, 'position'> & {
  position: string | null;
};
export function createMrStore(db: Database.Database = getDb()) {
  const parse = (row?: SessionRow): MrSession | null => row ? { ...row, snapshot: JSON.parse(row.snapshot), previous: row.previous ? JSON.parse(row.previous) : null } : null;
  function get(id: string) {
    return parse(db.prepare('SELECT * FROM mr_reviews WHERE id=?').get(id) as SessionRow | undefined);
  }
  function find(project: string, connection: string, hostPath: string, iid: number) {
    return parse(db.prepare('SELECT * FROM mr_reviews WHERE project_id=? AND connection_id=? AND project_path=? AND iid=?').get(project, connection, hostPath, iid) as SessionRow | undefined);
  }
  function save(project: string, connection: string, hostPath: string, iid: number, snapshot: MrSnapshot) {
    return db.transaction(() => {
      const old = find(project, connection, hostPath, iid), id = old?.id ?? randomUUID();
      const previous = old && old.snapshot.version.head_commit_sha !== snapshot.version.head_commit_sha ? old.snapshot : old?.previous;
      db.prepare("INSERT INTO mr_reviews(id,project_id,connection_id,project_path,iid,snapshot,previous) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,previous=excluded.previous,updated_at=datetime('now')").run(id, project, connection, hostPath, iid, JSON.stringify(snapshot), previous ? JSON.stringify(previous) : null);
      if (old)
        for (const f of old.snapshot.files)
          if (snapshot.files.find(x => x.new_path === f.new_path)?.diff !== f.diff)
            db.prepare('DELETE FROM mr_review_viewed WHERE review_id=? AND path=?').run(id, f.new_path);
      return get(id)!;
    })();
  }
  function drafts(id: string): MrDraft[] {
    return (db.prepare('SELECT * FROM mr_review_drafts WHERE review_id=? ORDER BY rowid').all(id) as DraftRow[]).map(d => ({ ...d, position: d.position ? JSON.parse(d.position) : null }));
  }
  function detail(id: string): MrDetail {
    const s = get(id)!, previous = s.previous;
    return { session: s, drafts: drafts(id), viewed: (db.prepare('SELECT path FROM mr_review_viewed WHERE review_id=?').all(id) as {
        path: string;
      }[]).map(x => x.path),
      changed_files: previous ? [...new Set([...previous.files, ...s.snapshot.files].filter(f => previous.files.find(p => p.new_path === f.new_path)?.diff !== s.snapshot.files.find(p => p.new_path === f.new_path)?.diff).map(f => f.new_path))] : [] };
  }
  function add(id: string, body: string, position: DiffPosition | null) {
    const key = randomUUID();
    db.prepare('INSERT INTO mr_review_drafts(id,review_id,body,position) VALUES (?,?,?,?)').run(key, id, body, position ? JSON.stringify(position) : null);
    return drafts(id).find(d => d.id === key)!;
  }
  function update(d: MrDraft) {
    db.prepare('UPDATE mr_review_drafts SET body=?,remote_id=?,status=?,error=? WHERE id=? AND review_id=?').run(d.body, d.remote_id, d.status, d.error, d.id, d.review_id);
  }
  function remove(id: string, key: string) {
    db.prepare('DELETE FROM mr_review_drafts WHERE id=? AND review_id=?').run(key, id);
  }
  function viewed(id: string, p: string, value: boolean) {
    if (value)
      db.prepare('INSERT OR IGNORE INTO mr_review_viewed(review_id,path) VALUES (?,?)').run(id, p);
    else
      db.prepare('DELETE FROM mr_review_viewed WHERE review_id=? AND path=?').run(id, p);
  }
  return { get, find, save, drafts, detail, add, update, remove, viewed };
}
