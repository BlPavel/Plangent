import { getDb } from '../../schema';

export const conflictRecords = {
  findOpenResolution: (projectId: string, workspaceId: string) => getDb().prepare("SELECT r.* FROM conflict_resolutions r JOIN agent_sessions s ON s.id=r.session_id WHERE r.project_id=? AND r.closed=0 AND coalesce(json_extract(s.metadata,'$.workspace_id'),'')=? ORDER BY r.rowid DESC LIMIT 1").get(projectId, workspaceId),
  closeResolution: (id: string) => getDb().prepare('UPDATE conflict_resolutions SET closed=1 WHERE id=?').run(id),
  listOrderedNotes: (id: string, step: string) => getDb().prepare('SELECT * FROM conflict_files WHERE resolution_id=? AND step=? ORDER BY path').all(id, step),
  listUnsentAnswers: (id: string, step: string) => getDb().prepare("SELECT * FROM conflict_files WHERE resolution_id=? AND step=? AND answer<>'' AND answer_sent=0").all(id, step),
  insertResolution: (id: string, projectId: string, operationId: string, sessionId: string) => getDb().prepare('INSERT INTO conflict_resolutions(id,project_id,operation_id,session_id) VALUES (?,?,?,?)').run(id, projectId, operationId, sessionId),
  markAnswersSent: (id: string, step: string) => getDb().prepare('UPDATE conflict_files SET answer_sent=1 WHERE resolution_id=? AND step=? AND answer<>\'\'').run(id, step),
  markAnswersUnsent: (id: string, step: string) => getDb().prepare('UPDATE conflict_files SET answer_sent=0 WHERE resolution_id=? AND step=? AND answer<>\'\'').run(id, step),
  findSessionResolution: (id: unknown, sessionId: string) => getDb().prepare('SELECT * FROM conflict_resolutions WHERE id=? AND session_id=? AND closed=0').get(id, sessionId),
  listNotes: (id: string, step: string) => getDb().prepare('SELECT * FROM conflict_files WHERE resolution_id=? AND step=?').all(id, step),
  saveReport: (id: string, step: string, path: string, outcome: string, text: string) => getDb().prepare(`INSERT INTO conflict_files(resolution_id,step,path,outcome,text) VALUES (?,?,?,?,?)
    ON CONFLICT(resolution_id,step,path) DO UPDATE SET outcome=excluded.outcome,text=excluded.text,answer='',answer_sent=0,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')`).run(id, step, path, outcome, text),
  saveAnswer: (text: string, id: string, step: string, path: string) => getDb().prepare("UPDATE conflict_files SET answer=?,answer_sent=0 WHERE resolution_id=? AND step=? AND path=? AND outcome='question'").run(text, id, step, path),
  transaction: (action: () => void): void => getDb().transaction(action)(),
};
