import fs from 'node:fs';
import path from 'node:path';
import { runCommand, readCommandLog } from '../../../infrastructure/terminal/command-runner';
import { configureSlotLimit } from '../../../infrastructure/terminal/command-slots';
import { readSetting } from '../../settings';
import { getProject } from '../../projects';
import { isInside } from '../../shared';
import { moduleDependencies } from '../dependencies';
import { permissionDecision, shellGitDecision } from './permissions';
import { captureTurn, authorizeCommand } from './acp-host';
import type { AgentSession } from './types';

// «Настройки» → number of heavy commands that may run at once on this machine; empty or 0 means automatic.
configureSlotLimit(() => Number(readSetting('command_slots').value) || 0);

const DEFAULT_TIMEOUT_S = 600, MAX_TIMEOUT_S = 3600, QUEUE_TIMEOUT_MS = 10 * 60_000;

/** The folder a command may start in: inside the session's own folders, resolved through links. */
async function commandFolder(session: AgentSession, requested: unknown): Promise<string> {
  const root = await moduleDependencies.workspaces.rootForSession(session);
  const roots = [root, ...await moduleDependencies.workspaces.writableRootsForSession(session)];
  const cwd = path.resolve(root, typeof requested === 'string' && requested.trim() ? requested : '.');
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('cwd is not a folder: ' + cwd);
  const real = fs.realpathSync(cwd);
  if (!roots.some(folder => fs.existsSync(folder) && isInside(fs.realpathSync(folder), real))) throw new Error('cwd is outside the folders of this session');
  return cwd;
}

/** Same rules as the agent's own shell: refused, allowed or asked of the developer by the session policy. */
async function authorize(session: AgentSession, command: string, signal: AbortSignal): Promise<void> {
  const toolCall = { toolCallId: 'run_command', kind: 'execute' as const, title: 'Shell command', rawInput: { command } };
  const decision = permissionDecision(session.policy, { sessionId: session.id, toolCall, options: [] }, getProject(session.project_id)?.config.dangerous_commands, undefined, session.role);
  if (decision === 'allow') return;
  if (decision === 'deny') {
    throw new Error(shellGitDecision(toolCall) === 'deny' ? 'Shell Git command refused. Request repository changes with the Plangent git_action tool.'
      : session.policy === 'read-only' ? 'Commands are not allowed in a read-only session' : 'The command is not allowed in this session');
  }
  if (!await authorizeCommand(session.id, 'Команда: ' + command.slice(0, 300), signal)) throw new Error('The developer did not allow this command');
}

export async function runSessionCommand(session: AgentSession, args: Record<string, unknown>) {
  const command = String(args.command ?? '').trim();
  if (!command) throw new Error('Invalid command');
  if (session.metadata.mr_private) throw new Error('Commands are not available in this session');
  const seconds = args.timeout_seconds === undefined ? DEFAULT_TIMEOUT_S : Number(args.timeout_seconds);
  if (!Number.isFinite(seconds) || seconds < 1) throw new Error('Invalid timeout_seconds');
  const signal = captureTurn(session.id);
  const cwd = await commandFolder(session, args.cwd);
  await authorize(session, command, signal);
  const project = getProject(session.project_id);
  const result = await runCommand({ owner: session.id, command, cwd, heavy: args.heavy !== false, signal,
    env: { ...project?.config.extra_env, ...moduleDependencies.workspaces.envForSession(session) },
    timeoutMs: Math.min(seconds, MAX_TIMEOUT_S) * 1000, queueTimeoutMs: QUEUE_TIMEOUT_MS });
  const status = result.queueTimedOut ? 'queue_timeout' : result.cancelled ? 'cancelled' : result.timedOut ? 'timed_out' : result.exitCode === 0 ? 'ok' : 'failed';
  return { status, ...(result.queueTimedOut ? { note: 'All command slots stayed busy; try again later. Only short commands should use heavy=false.' } : {}),
    commandId: result.id, exitCode: result.exitCode, ...(result.signal ? { signal: result.signal } : {}),
    waitedSeconds: Math.round(result.waitedMs / 1000), ranSeconds: Math.round(result.ranMs / 1000),
    ...(result.omittedLines ? { omittedLines: result.omittedLines } : {}), output: result.output };
}

export function readSessionCommandOutput(session: AgentSession, args: Record<string, unknown>) {
  const number = (value: unknown) => value === undefined ? undefined : Number(value);
  const from = number(args.from), count = number(args.count);
  if ([from, count].some(value => value !== undefined && (!Number.isInteger(value) || value < 1))) throw new Error('from and count must be positive integers');
  const { text, totalLines } = readCommandLog(session.id, String(args.commandId), { grep: typeof args.grep === 'string' && args.grep ? args.grep : undefined, from, count });
  return { totalLines, text };
}
