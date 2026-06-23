import { Agent } from '../../models';

export interface RunContext {
  projectName: string;
  taskKey: string;
  taskTitle?: string;
  taskDescription?: string;
  planContent?: string;
  planFilePath?: string;
  points?: string[];
  purpose?: 'plan' | 'execute';
  runHistory: Array<{
    agent: string;
    date: string;
    completed: string[];
    notes?: string;
  }>;
}

export interface LaunchResult {
  sessionId: string;
  mode: 'tmux' | 'pty';
  pid?: number;
}

interface AgentRuntime {
  buildPrompt(ctx: RunContext): string;
  launchAgent(
    agent: Agent,
    cwd: string,
    sessionId: string,
    extraEnv?: Record<string, string>,
    initialPrompt?: string,
  ): Promise<LaunchResult>;
  killAgent(sessionId: string, mode: 'tmux' | 'pty'): Promise<void>;
  deployClaudeStopHook(repoCwd: string, callbackUrl: string): void;
  cleanupClaudeStopHook(repoCwd: string): void;
}

let runtime: AgentRuntime | null = null;

function getRuntime(): AgentRuntime {
  if (!runtime) throw new Error('Agent runtime is not configured');
  return runtime;
}

export function configureAgentRuntime(nextRuntime: AgentRuntime): void {
  runtime = nextRuntime;
}

export function buildPrompt(ctx: RunContext): string {
  return getRuntime().buildPrompt(ctx);
}

export function launchAgent(
  agent: Agent,
  cwd: string,
  sessionId: string,
  extraEnv?: Record<string, string>,
  initialPrompt?: string,
): Promise<LaunchResult> {
  return getRuntime().launchAgent(agent, cwd, sessionId, extraEnv, initialPrompt);
}

export function killAgent(sessionId: string, mode: 'tmux' | 'pty'): Promise<void> {
  return getRuntime().killAgent(sessionId, mode);
}

export function deployClaudeStopHook(repoCwd: string, callbackUrl: string): void {
  getRuntime().deployClaudeStopHook(repoCwd, callbackUrl);
}

export function cleanupClaudeStopHook(repoCwd: string): void {
  getRuntime().cleanupClaudeStopHook(repoCwd);
}
