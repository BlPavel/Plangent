import { getDb } from '../../schema';
function db() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS agent_acp_options (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, options TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  return getDb();
}
export function readOptions(agentId: string): string | undefined {
  return (db().prepare('SELECT options FROM agent_acp_options WHERE agent_id=?').get(agentId) as { options: string } | undefined)?.options;
}
export function clearAcpOptions(agentId: string): void { db().prepare('DELETE FROM agent_acp_options WHERE agent_id=?').run(agentId); }
export function writeOptions(agentId: string, options: string, at: number): void {
  db().prepare('INSERT INTO agent_acp_options(agent_id, options, updated_at) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET options=excluded.options, updated_at=excluded.updated_at').run(agentId, options, at);
}
