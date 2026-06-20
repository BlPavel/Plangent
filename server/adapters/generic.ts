import { createPtySession, killPtySession, getPtySession } from '../terminal/pty-manager';
import { TmuxManager } from '../terminal/tmux';
import { Agent } from '../models/types';
import fs from 'fs';
import path from 'path';

export interface RunContext {
  projectName: string;
  taskKey: string;
  taskTitle?: string;
  taskDescription?: string;
  planContent?: string;
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

export function buildPrompt(ctx: RunContext): string {
  const lines: string[] = [];
  lines.push(`# Задача: ${ctx.taskKey}${ctx.taskTitle ? ` — ${ctx.taskTitle}` : ''}`);
  lines.push(`Проект: ${ctx.projectName}`);
  lines.push('');

  if (ctx.taskDescription) {
    lines.push('## Описание');
    lines.push(ctx.taskDescription);
    lines.push('');
  }

  if (ctx.runHistory.length > 0) {
    lines.push('## История запусков');
    for (const r of ctx.runHistory) {
      const steps = r.completed.join(', ') || 'нет данных';
      lines.push(`- **${r.agent}** (${r.date}): выполнено — ${steps}${r.notes ? ` | ${r.notes}` : ''}`);
    }
    lines.push('');
  }

  if (ctx.planContent) {
    lines.push('## Текущий план');
    lines.push(ctx.planContent);
    lines.push('');
    lines.push('Продолжи выполнение плана. Отмечай выполненные шаги: `- [x]`.');
    lines.push('После завершения обнови файл PLAN.md в корне проекта.');
  } else {
    lines.push('## Инструкция');
    lines.push('Составь подробный план выполнения задачи в markdown с чекбоксами:');
    lines.push('```');
    lines.push('- [ ] Шаг 1');
    lines.push('- [ ] Шаг 2');
    lines.push('```');
    lines.push('Сохрани план в файл PLAN.md в корне проекта, затем выполняй шаги.');
  }

  return lines.join('\n');
}

export async function launchAgent(
  agent: Agent,
  cwd: string,
  sessionId: string,
  extraEnv?: Record<string, string>,
): Promise<LaunchResult> {
  const agentEnv: Record<string, string> = {
    ...agent.env,
    ...(extraEnv ?? {}),
  };

  if (TmuxManager.isTmuxAvailable()) {
    const tmux = new TmuxManager(sessionId);
    const envStr = Object.entries(agentEnv)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join(' && ');

    const args = agent.args.join(' ');
    await tmux.create();
    if (envStr) await tmux.sendKeys(envStr);
    await tmux.sendKeys(`cd "${cwd}"`);
    await tmux.sendKeys(`${agent.command}${args ? ` ${args}` : ''}`);
    return { sessionId, mode: 'tmux' };
  } else {
    // Spawn a login shell so it picks up the full user PATH (~/.local/bin, nvm, etc.)
    const shell = process.env.SHELL || '/bin/zsh';
    const session = createPtySession(sessionId, shell, ['-l'], cwd, agentEnv);

    // Give shell a moment to initialise, then launch the agent inside it
    const agentCmd = [agent.command, ...agent.args].join(' ');
    const envExports = Object.entries(agentEnv)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join('\n');

    setTimeout(() => {
      const s = getPtySession(sessionId);
      if (!s) return;
      if (envExports) s.pty.write(envExports + '\r');
      s.pty.write(`cd "${cwd}"\r`);
      s.pty.write(`${agentCmd}\r`);
    }, 500);

    return { sessionId, mode: 'pty', pid: session.pty.pid };
  }
}

export async function sendToAgent(sessionId: string, mode: 'tmux' | 'pty', text: string): Promise<void> {
  if (mode === 'tmux') {
    const tmux = new TmuxManager(sessionId);
    await tmux.sendKeys(text);
  } else {
    const s = getPtySession(sessionId);
    if (s) s.pty.write(text + '\r');
  }
}

export async function killAgent(sessionId: string, mode: 'tmux' | 'pty'): Promise<void> {
  if (mode === 'tmux') {
    await new TmuxManager(sessionId).kill();
  } else {
    killPtySession(sessionId);
  }
}

export function deploySkillsToProject(
  agent: Agent,
  repoCwd: string,
  commonSkills: string | null,
  projectSkills: string | null,
): string | null {
  const parts = [commonSkills, projectSkills].filter((s): s is string => !!s);
  if (parts.length === 0 || !agent.skills_filename) return null;

  const content = parts.join('\n\n---\n\n');
  const targetDir = agent.skills_dir
    ? path.join(repoCwd, agent.skills_dir)
    : repoCwd;

  fs.mkdirSync(targetDir, { recursive: true });

  const filePath = path.join(targetDir, agent.skills_filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function cleanupSkillsFromProject(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
