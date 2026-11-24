import { exec } from 'child_process';
import { promisify } from 'util';
import { Agent } from '../../../models';
import { clearAcpOptions } from './acp-options';
import { agentPresets } from './presets';
import { installAgentCli } from '../../../infrastructure/acp/cli-install';

const execAsync = promisify(exec);

// Match the saved preset commands, including Claude's existing npm update command.
const presetCliPackages = new Map(Object.values(agentPresets).flatMap(({ update_command }) => {
  const match = /^npm (?:install|update) -g (@[\w.-]+\/[\w.-]+)(?:@latest)?$/.exec(update_command);
  return match ? [[update_command, `${match[1]}@latest`] as const] : [];
}));

export { listAgents, getAgent, createAgent } from '../../../infrastructure/db/repositories/agents/catalog';
export type { AgentInput } from '../../../infrastructure/db/repositories/agents/catalog';
import { getAgent, updateAgent as persistAgent } from '../../../infrastructure/db/repositories/agents/catalog';
export function updateAgent(id: string, data: Partial<Omit<Agent, 'id' | 'created_at'>>): Agent | null {
  const current = getAgent(id);
  const updated = persistAgent(id, data);
  const connection = (a: Agent) => JSON.stringify([a.acp_command, a.acp_args, a.env, a.use_proxy]);
  if (current && updated && connection(current) !== connection(updated)) clearAcpOptions(id);
  return updated;
}
export interface AgentUpdateResult {
  /** The agent's own CLI (update_command); null when none is set. */
  cli: { ok: true; output: string } | { ok: false; error: string } | null;
  /** The npm package the ACP adapter is pinned to; null when the args pin none. */
  adapter: { ok: true; package: string; from: string; to: string } | { ok: false; package: string; error: string } | null;
}

async function run(command: string, timeout: number, stdoutOnly = false): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), timeout, maxBuffer: 1024 * 1024, windowsHide: true });
    return stdoutOnly ? stdout.trim() : [stdout, stderr].filter(Boolean).join('\n').trim();
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
    const latest = await run(`npm view ${pkg} version`, 60_000, true);
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
    const spec = process.platform === 'darwin' ? presetCliPackages.get(agent.update_command.trim()) : undefined;
    try {
      const output = spec ? await installAgentCli(spec) : await run(agent.update_command, 300_000);
      if (spec) clearAcpOptions(id);
      cli = { ok: true, output };
    }
    catch (e) { cli = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  if (!cli && !adapter) throw new Error('Нечего обновлять: не задана команда обновления и адаптер не закреплён на версии из npm');
  return { cli, adapter };
}
