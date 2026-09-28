import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../../infrastructure/db/schema';
import { Agent } from '../../models';
import { clearAcpOptions } from './acp-options';

const execAsync = promisify(exec);

function parse(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    acp_command: (row.acp_command as string) ?? '',
    acp_args: JSON.parse(row.acp_args as string || '[]'),
    env: JSON.parse(row.env as string || '{}'),
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
    ? 'SELECT * FROM agents WHERE active = 1 ORDER BY created_at ASC'
    : 'SELECT * FROM agents ORDER BY created_at ASC';
  return (getDb().prepare(sql).all() as Record<string, unknown>[]).map(parse);
}

export function getAgent(id: string): Agent | null {
  const row = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export type AgentInput = Partial<Omit<Agent, 'id' | 'created_at'>> & { name: string };

export function createAgent(data: AgentInput): Agent {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO agents (id, name, acp_command, acp_args, env, command, update_command, layout_profile, model, reasoning_effort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, data: Partial<Omit<Agent, 'id' | 'created_at'>>): Agent | null {
  const current = getAgent(id);
  if (!current) return null;
  const u = { ...current, ...data, layout_profile: data.layout_profile !== undefined ? data.layout_profile : current.layout_profile };
  getDb().prepare(`
    UPDATE agents SET name=?, acp_command=?, acp_args=?, env=?, command=?, update_command=?, layout_profile=?, model=?, reasoning_effort=?, active=? WHERE id=?
  `).run(
    u.name, u.acp_command, JSON.stringify(u.acp_args), JSON.stringify(u.env), u.command, u.update_command,
    u.layout_profile ? JSON.stringify(u.layout_profile) : null,
    u.model, u.reasoning_effort, u.active ? 1 : 0, id,
  );
  // What the agent reported may differ once it is started differently.
  const connection = (a: Agent) => JSON.stringify([a.acp_command, a.acp_args, a.env]);
  if (connection(current) !== connection(u)) clearAcpOptions(id);
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const db = getDb();
  const tx = db.transaction((agentId: string) => {
    db.prepare('UPDATE projects SET default_agent_id = NULL WHERE default_agent_id = ?').run(agentId);
    db.prepare('UPDATE runs SET agent_id = NULL WHERE agent_id = ?').run(agentId);
    return db.prepare('DELETE FROM agents WHERE id = ?').run(agentId).changes > 0;
  });
  return tx(id);
}

export async function updateAgentCli(id: string): Promise<{ output: string }> {
  const agent = getAgent(id);
  if (!agent) throw new Error('Agent not found');
  if (!agent.update_command.trim()) throw new Error('Команда обновления не задана');

  try {
    const { stdout, stderr } = await execAsync(agent.update_command, {
      cwd: process.cwd(),
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { output: [stdout, stderr].filter(Boolean).join('\n').trim() };
  } catch (error: unknown) {
    const e = error as { stderr?: string; stdout?: string; message: string };
    throw new Error([e.message, e.stdout, e.stderr].filter(Boolean).join('\n').trim());
  }
}
