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

export interface AgentUpdateResult {
  /** The agent's own CLI (update_command); null when none is set. */
  cli: { ok: true; output: string } | { ok: false; error: string } | null;
  /** The npm package the ACP adapter is pinned to; null when the args pin none. */
  adapter: { ok: true; package: string; from: string; to: string } | { ok: false; package: string; error: string } | null;
}

async function run(command: string, timeout: number): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), timeout, maxBuffer: 1024 * 1024, windowsHide: true });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  } catch (error: unknown) {
    const e = error as { stderr?: string; stdout?: string; message: string };
    throw new Error([e.message, e.stdout, e.stderr].filter(Boolean).join('\n').trim());
  }
}

// `@scope/name@1.2.3` or `name@1.2.3` — an adapter started through npx with an exact version.
const PINNED_PACKAGE = /^((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

function newerVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  // Same numbers: a release is newer than its prerelease.
  return !a.includes('-') && b.includes('-');
}

/** Move the adapter's pinned version to the latest one on npm. */
async function updateAdapter(agent: Agent): Promise<AgentUpdateResult['adapter']> {
  const index = agent.acp_args.findIndex(arg => PINNED_PACKAGE.test(arg));
  if (index < 0) return null;
  const [, pkg, from] = PINNED_PACKAGE.exec(agent.acp_args[index])!;
  try {
    const latest = (await run(`npm view ${pkg} version`, 60_000)).split('\n').pop()!.trim();
    if (!PINNED_PACKAGE.test(`${pkg}@${latest}`)) throw new Error(`npm вернул неожиданную версию: ${latest}`);
    if (!newerVersion(latest, from)) return { ok: true, package: pkg, from, to: from };
    const acp_args = agent.acp_args.map((arg, i) => (i === index ? `${pkg}@${latest}` : arg));
    // A new start command drops the cached models, so the next probe asks the new version.
    updateAgent(agent.id, { acp_args });
    return { ok: true, package: pkg, from, to: latest };
  } catch (e) {
    return { ok: false, package: pkg, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Update the agent's CLI and move its ACP adapter to the latest version. */
export async function updateAgentCli(id: string): Promise<AgentUpdateResult> {
  const agent = getAgent(id);
  if (!agent) throw new Error('Agent not found');

  const adapter = await updateAdapter(agent);
  let cli: AgentUpdateResult['cli'] = null;
  if (agent.update_command.trim()) {
    try { cli = { ok: true, output: await run(agent.update_command, 300_000) }; }
    catch (e) { cli = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  if (!cli && !adapter) throw new Error('Нечего обновлять: не задана команда обновления и адаптер не закреплён на версии из npm');
  return { cli, adapter };
}
