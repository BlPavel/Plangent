import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../schema';
import type { Agent } from '../../../../models';
function parse(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    acp_command: (row.acp_command as string) ?? '',
    acp_args: JSON.parse(row.acp_args as string || '[]'),
    env: JSON.parse(row.env as string || '{}'),
    use_proxy: Boolean(row.use_proxy),
    command: row.command as string,
    update_command: row.update_command as string,
    layout_profile: row.layout_profile ? JSON.parse(row.layout_profile as string) : null,
    model: row.model as string,
    reasoning_effort: row.reasoning_effort as string,
    active: Boolean(row.active),
    created_at: row.created_at as string,
  };
}

export function listAgents(activeOnly = false): Agent[] {
  const sql = activeOnly
    ? 'SELECT * FROM agents WHERE deleted_at IS NULL AND active = 1 ORDER BY created_at ASC'
    : 'SELECT * FROM agents WHERE deleted_at IS NULL ORDER BY created_at ASC';
  return (getDb().prepare(sql).all() as Record<string, unknown>[]).map(parse);
}

export function getAgent(id: string): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export type AgentInput = Partial<Omit<Agent, 'id' | 'created_at'>> & { name: string };

export function createAgent(data: AgentInput): Agent {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO agents (id, name, acp_command, acp_args, env, command, update_command, layout_profile, model, reasoning_effort, use_proxy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.acp_command ?? '',
    JSON.stringify(data.acp_args ?? []),
    JSON.stringify(data.env ?? {}),
    data.command ?? '',
    data.update_command ?? '',
    data.layout_profile ? JSON.stringify(data.layout_profile) : null,
    data.model ?? '',
    data.reasoning_effort ?? '',
    data.use_proxy ? 1 : 0,
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, data: Partial<Omit<Agent, 'id' | 'created_at'>>): Agent | null {
  const current = getAgent(id);
  if (!current) return null;
  const u = { ...current, ...data, layout_profile: data.layout_profile !== undefined ? data.layout_profile : current.layout_profile };
  getDb().prepare(`
    UPDATE agents SET name=?, acp_command=?, acp_args=?, env=?, command=?, update_command=?, layout_profile=?, model=?, reasoning_effort=?, active=?, use_proxy=? WHERE id=?
  `).run(
    u.name, u.acp_command, JSON.stringify(u.acp_args), JSON.stringify(u.env), u.command, u.update_command,
    u.layout_profile ? JSON.stringify(u.layout_profile) : null,
    u.model, u.reasoning_effort, u.active ? 1 : 0, u.use_proxy ? 1 : 0, id,
  );
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((agentId: string) => {
    const agent = getAgent(agentId);
    if (!agent) return false;
    db.prepare('UPDATE projects SET default_agent_id = NULL WHERE default_agent_id = ?').run(agentId);
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'").get()) {
      db.prepare("UPDATE agent_sessions SET metadata=json_set(metadata, '$.deletedAgentName', ?) WHERE agent_id=?").run(agent.name, agentId);
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_acp_options'").get()) {
      db.prepare('DELETE FROM agent_acp_options WHERE agent_id=?').run(agentId);
    }
    // Release the unique display name so the developer can create a replacement.
    return db.prepare("UPDATE agents SET deleted_at=datetime('now'), active=0, name=? WHERE id=? AND deleted_at IS NULL")
      .run(`${agent.name} [deleted:${agentId}]`, agentId).changes > 0;
  });
  return tx(id);
}

