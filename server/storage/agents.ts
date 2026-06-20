import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { Agent } from '../models/types';

function parse(row: Record<string, unknown>): Agent {
  return {
    ...(row as Omit<Agent, 'args' | 'env' | 'active'>),
    args: JSON.parse(row.args as string || '[]'),
    env: JSON.parse(row.env as string || '{}'),
    active: Boolean(row.active),
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

export function createAgent(data: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  skills_dir?: string;
  skills_filename?: string;
}): Agent {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO agents (id, name, command, args, env, skills_dir, skills_filename)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.command,
    JSON.stringify(data.args ?? []),
    JSON.stringify(data.env ?? {}),
    data.skills_dir ?? '',
    data.skills_filename ?? 'plangent-skills.md',
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, data: Partial<Omit<Agent, 'id' | 'created_at'>>): Agent | null {
  const current = getAgent(id);
  if (!current) return null;
  const u = {
    ...current,
    ...data,
    args: data.args ?? current.args,
    env: data.env ?? current.env,
  };
  getDb().prepare(`
    UPDATE agents SET name=?, command=?, args=?, env=?, skills_dir=?, skills_filename=?, active=? WHERE id=?
  `).run(u.name, u.command, JSON.stringify(u.args), JSON.stringify(u.env), u.skills_dir, u.skills_filename, u.active ? 1 : 0, id);
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  return getDb().prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
}
