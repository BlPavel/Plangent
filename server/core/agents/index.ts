import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../../infrastructure/db/schema';
import { Agent } from '../../models';

const execAsync = promisify(exec);

function parse(row: Record<string, unknown>): Agent {
  return {
    ...(row as Omit<Agent, 'args' | 'env' | 'layout_profile' | 'model_options' | 'reasoning_options' | 'active'>),
    args: JSON.parse(row.args as string || '[]'),
    env: JSON.parse(row.env as string || '{}'),
    layout_profile: row.layout_profile ? JSON.parse(row.layout_profile as string) : null,
    model_options: JSON.parse(row.model_options as string || '[]'),
    reasoning_options: JSON.parse(row.reasoning_options as string || '[]'),
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
  update_command?: string;
  args?: string[];
  env?: Record<string, string>;
  skills_dir?: string;
  skills_filename?: string;
  layout_profile?: object | null;
  model?: string;
  reasoning_effort?: string;
  model_options?: string[];
  reasoning_options?: string[];
}): Agent {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO agents (id, name, command, update_command, args, env, skills_dir, skills_filename, layout_profile, model, reasoning_effort, model_options, reasoning_options)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.command,
    data.update_command ?? '',
    JSON.stringify(data.args ?? []),
    JSON.stringify(data.env ?? {}),
    data.skills_dir ?? '',
    data.skills_filename ?? 'plangent-skills.md',
    data.layout_profile ? JSON.stringify(data.layout_profile) : null,
    data.model ?? '',
    data.reasoning_effort ?? '',
    JSON.stringify(data.model_options ?? []),
    JSON.stringify(data.reasoning_options ?? []),
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
    layout_profile: data.layout_profile !== undefined ? data.layout_profile : current.layout_profile,
    model_options: data.model_options ?? current.model_options,
    reasoning_options: data.reasoning_options ?? current.reasoning_options,
  };
  getDb().prepare(`
    UPDATE agents SET name=?, command=?, update_command=?, args=?, env=?, skills_dir=?, skills_filename=?, layout_profile=?, model=?, reasoning_effort=?, model_options=?, reasoning_options=?, active=? WHERE id=?
  `).run(
    u.name, u.command, u.update_command, JSON.stringify(u.args), JSON.stringify(u.env),
    u.skills_dir, u.skills_filename,
    u.layout_profile ? JSON.stringify(u.layout_profile) : null,
    u.model, u.reasoning_effort,
    JSON.stringify(u.model_options), JSON.stringify(u.reasoning_options),
    u.active ? 1 : 0, id,
  );
  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  return getDb().prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
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
