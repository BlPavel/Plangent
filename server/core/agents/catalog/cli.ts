import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../../../models';
import { installAgentCli } from '../../../infrastructure/acp/cli-install';
import { resolvedAgentEnv } from '../sessions/env';
import { clearAcpOptions } from './acp-options';
import { agentPresets, presetForAgentId } from './presets';

export interface AgentInstallPlan {
  /** npm package that provides the CLI. */
  package: string;
  version: string;
  /** Executable name used by the agent. */
  bin: string;
  /** The command Plangent launches. */
  command: string;
}

export interface AgentCliStatus {
  command: string;
  bin: string;
  installed: boolean;
  installable: boolean;
  package: string | null;
  state: 'idle' | 'installing' | 'done' | 'error';
  error?: string;
}

/** Seeded agents have no ACP command of their own and start from their preset. */
export function launchCommandFor(agent: Pick<Agent, 'id' | 'acp_command' | 'acp_args'>): { command: string; args: string[] } {
  const preset = agentPresets[presetForAgentId[agent.id]];
  return { command: agent.acp_command || preset?.acp_command || '',
    args: agent.acp_command ? agent.acp_args ?? [] : preset?.acp_args ?? [] };
}

// Only the forms the application can run safely without a shell: a global npm install from a preset.
// Arbitrary update commands stay behind the explicit "Обновить" button.
const NPM_GLOBAL_INSTALL = /^npm (?:install|update) (?:-g|--global) ((?:@[\w.-]+\/)?[\w.-]+)(?:@([\w.+-]+))?$/i;

const executableName = (command: string) => path.basename(command).replace(/\.(?:cmd|exe)$/i, '').toLowerCase();

function npmInstall(command: string): { package: string; version: string } | null {
  const match = NPM_GLOBAL_INSTALL.exec(command.trim());
  return match ? { package: match[1], version: match[2] || 'latest' } : null;
}

/** The managed npm install for an update command, on every platform; null when the command is not a plain npm install. */
export function managedNpmSpec(command: string): string | null {
  const spec = npmInstall(command);
  return spec ? `${spec.package}@${spec.version}` : null;
}

export function agentInstallPlan(agent: Pick<Agent, 'id' | 'acp_command' | 'acp_args' | 'command' | 'update_command'>): AgentInstallPlan | null {
  const launch = launchCommandFor(agent);
  if (!launch.command || executableName(launch.command) === 'npx') return null;
  const spec = npmInstall(agent.update_command);
  if (!spec) return null;
  return { ...spec, bin: agent.command.trim() || executableName(launch.command), command: launch.command };
}

function isFile(file: string): boolean {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}

/** Resolve a command the way spawn does: an explicit path, or a PATH lookup with PATHEXT on Windows. */
export function isCommandAvailable(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!command.trim()) return false;
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (base: string) => {
    if (process.platform !== 'win32') return [base];
    return extensions.some(ext => base.toLowerCase().endsWith(ext.toLowerCase()))
      ? [base] : [base, ...extensions.map(ext => base + ext)];
  };
  if (command.includes('/') || command.includes('\\')) return candidates(command).some(isFile);
  const folders = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  return folders.some(folder => candidates(path.join(folder, command)).some(isFile));
}

const states = new Map<string, { state: Exclude<AgentCliStatus['state'], 'idle'>; error?: string; at: number }>();
const jobs = new Map<string, Promise<void>>();

/** Missing CLI prevents an ACP launch and carries what the client needs to offer installation. */
export class AgentCliMissingError extends Error {
  readonly code = 'agent_cli_missing';
  constructor(readonly command: string, readonly plan: AgentInstallPlan | null) {
    super(!plan && executableName(command) === 'npx'
      ? 'Для запуска агента нужен Node.js/npm (npx). Установите Node.js и повторите.'
      : plan
        ? `CLI «${command}» не установлен. Установите: npm install -g ${plan.package}@${plan.version}`
        : `CLI «${command}» не установлен. Установите его вручную.`);
  }
  get install() {
    return this.plan ? { package: `${this.plan.package}@${this.plan.version}`, command: this.command, bin: this.plan.bin } : null;
  }
}

export async function agentCliStatus(agent: Agent, env?: NodeJS.ProcessEnv): Promise<AgentCliStatus> {
  const plan = agentInstallPlan(agent);
  const launch = launchCommandFor(agent);
  const current = states.get(agent.id);
  const installed = isCommandAvailable(launch.command, env ?? await resolvedAgentEnv(agent));
  return {
    command: launch.command,
    bin: plan?.bin ?? executableName(launch.command),
    installed,
    installable: !!plan,
    package: plan ? `${plan.package}@${plan.version}` : null,
    state: installed ? 'done' : current?.state ?? 'idle',
    ...(installed ? {} : current?.error ? { error: current.error } : {}),
  };
}

/** Install the agent's npm CLI into Plangent's data folder. One job per agent; callers may poll status. */
export function installAgentCliForAgent(agent: Agent): Promise<void> {
  const running = jobs.get(agent.id);
  if (running) return running;
  const job = (async () => {
    const plan = agentInstallPlan(agent);
    if (!plan) throw new Error('Для этого агента нет команды автоматической установки. Установите CLI вручную.');
    states.set(agent.id, { state: 'installing', at: Date.now() });
    try {
      await installAgentCli(`${plan.package}@${plan.version}`, await resolvedAgentEnv(agent));
      clearAcpOptions(agent.id);
      states.set(agent.id, { state: 'done', at: Date.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      states.set(agent.id, { state: 'error', error: message.slice(-2000), at: Date.now() });
      throw error;
    } finally { jobs.delete(agent.id); }
  })();
  jobs.set(agent.id, job);
  return job;
}

export function forgetAgentCliState(agentId: string): void { states.delete(agentId); }
