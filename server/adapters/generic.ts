import { createPtySession, killPtySession, getPtySession } from '../terminal/pty-manager';
import { TmuxManager } from '../terminal/tmux';
import { Agent } from '../models/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface RunContext {
  projectName: string;
  taskKey: string;
  taskTitle?: string;
  taskDescription?: string;
  planContent?: string;
  planFilePath?: string;    // relative path inside repo, e.g. .plangent/KEY.plan.md
  points?: string[];        // specific point ids for this session
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

const PLAN_PROTOCOL_HEADER = `
## Plangent Plan Protocol

Your task plan is stored in a file inside the repository (path shown below).
The file uses this format:

\`\`\`
---
plangent: 1
key: KEY
title: Task title
status: open|in_progress|done
---

- [ ] (p1) First step @parallel:groupA
- [x] (p2) Completed step
- [ ] (p3) Another step
\`\`\`

**Rules you MUST follow:**
1. Check off steps as you complete them: change \`- [ ]\` to \`- [x]\`.
2. Keep \`(pN)\` ids exactly as-is — never rename or remove them.
3. New steps you add will get ids assigned automatically — leave them blank initially.
4. NEVER run any git commands (no commit, no branch, no push, no merge).
5. When you finish your assigned steps and have no more work to do, stop and wait for input.
`;

// Planning-mode prompt: ONLY teaches how to write the plan and tells the agent to
// wait for the developer to describe the task. It deliberately does NOT frame the
// task as something to execute — the developer drives the conversation in the terminal.
function buildPlanningPrompt(ctx: RunContext): string {
  const lines: string[] = [];
  const planPath = ctx.planFilePath ? `\`${ctx.planFilePath}\`` : 'the plan file';

  lines.push(PLAN_PROTOCOL_HEADER.trim());
  lines.push('');
  lines.push('## You are in PLANNING mode');
  lines.push(
    `Task key: \`${ctx.taskKey}\`${ctx.taskTitle ? ` — ${ctx.taskTitle}` : ''} ` +
    '(context only — do NOT infer the task from this).',
  );
  lines.push('');
  lines.push('**Do NOT write code, run commands, or execute anything.** In this session your only job is to produce a plan.');
  lines.push('');

  if (ctx.planContent) {
    lines.push(`A plan already exists in ${planPath}. Wait for the developer to tell you, in this chat, what to change. Then update the plan file per the protocol above, keeping existing \`(pN)\` ids.`);
    lines.push('');
    lines.push('Current plan:');
    lines.push('```');
    lines.push(ctx.planContent);
    lines.push('```');
  } else {
    lines.push('Wait for the developer to describe the task in this chat. When they have, write the plan into ' + planPath + ' per the protocol above:');
    lines.push('- break the work into clear checkbox steps `- [ ] text` (ids are assigned automatically — leave them out);');
    lines.push('- you may add any prose, headings or notes around the steps — only the checkboxes become tracked steps;');
    lines.push('- after writing the plan, STOP and wait for review. Do NOT start executing.');
  }
  lines.push('');
  return lines.join('\n');
}

export function buildPrompt(ctx: RunContext): string {
  if (ctx.purpose === 'plan') return buildPlanningPrompt(ctx);

  const lines: string[] = [];

  lines.push(PLAN_PROTOCOL_HEADER.trim());
  lines.push('');

  lines.push(`# Task: ${ctx.taskKey}${ctx.taskTitle ? ` — ${ctx.taskTitle}` : ''}`);
  lines.push(`Project: ${ctx.projectName}`);
  lines.push('');

  if (ctx.taskDescription) {
    lines.push('## Description');
    lines.push(ctx.taskDescription);
    lines.push('');
  }

  if (ctx.planFilePath) {
    lines.push(`## Plan file`);
    lines.push(`\`${ctx.planFilePath}\``);
    lines.push('');
  }

  if (ctx.points && ctx.points.length > 0) {
    lines.push('## Your assigned steps for this session');
    lines.push('Execute **only** the steps with these ids (in order):');
    for (const p of ctx.points) {
      lines.push(`- \`${p}\``);
    }
    lines.push('');
    lines.push('Do not work on steps outside this list. Check them off as you complete each one.');
    lines.push('');
  } else if (ctx.planContent) {
    lines.push('## Current plan');
    lines.push(ctx.planContent);
    lines.push('');
    lines.push('Continue executing the plan. Check off completed steps: `- [x]`.');
    lines.push('');
  } else {
    lines.push('## Instruction');
    lines.push('Create a detailed plan for this task in the plan file.');
    lines.push('Use the Plangent Plan Protocol format shown above.');
    lines.push('Then execute the steps.');
    lines.push('');
  }

  if (ctx.runHistory.length > 0) {
    lines.push('## Run history');
    for (const r of ctx.runHistory) {
      const steps = r.completed.join(', ') || 'none';
      lines.push(`- **${r.agent}** (${r.date}): completed — ${steps}${r.notes ? ` | ${r.notes}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Write prompt to a temp file and return its path.
// Caller is responsible for deleting it after the agent starts.
function writePromptTempFile(prompt: string, runId: string): string {
  const tmpPath = path.join(os.tmpdir(), `plangent-prompt-${runId}.md`);
  fs.writeFileSync(tmpPath, prompt, 'utf-8');
  return tmpPath;
}

export async function launchAgent(
  agent: Agent,
  cwd: string,
  sessionId: string,
  extraEnv?: Record<string, string>,
  initialPrompt?: string,
): Promise<LaunchResult> {
  const agentEnv: Record<string, string> = {
    ...agent.env,
    ...(extraEnv ?? {}),
  };

  // Build the agent launch command, injecting prompt as a positional arg via temp file
  const baseCommand = agent.command;
  const baseArgs = [...agent.args];

  if (TmuxManager.isTmuxAvailable()) {
    const tmux = new TmuxManager(sessionId);
    const envStr = Object.entries(agentEnv)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join(' && ');

    await tmux.create();
    if (envStr) await tmux.sendKeys(envStr);
    await tmux.sendKeys(`cd "${cwd}"`);

    if (initialPrompt) {
      // Write to temp file and clean up after a short delay
      const tmpFile = writePromptTempFile(initialPrompt, sessionId);
      const argsStr = baseArgs.join(' ');
      await tmux.sendKeys(`${baseCommand}${argsStr ? ` ${argsStr}` : ''} "$(cat '${tmpFile}')"`);
      // Clean up temp file after the shell expands it (give it 2s)
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 2000);
    } else {
      const argsStr = baseArgs.join(' ');
      await tmux.sendKeys(`${baseCommand}${argsStr ? ` ${argsStr}` : ''}`);
    }

    return { sessionId, mode: 'tmux' };
  } else {
    const shell = process.env.SHELL || '/bin/zsh';
    const session = createPtySession(sessionId, shell, ['-l'], cwd, agentEnv);

    const envExports = Object.entries(agentEnv)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join('\n');

    setTimeout(() => {
      const s = getPtySession(sessionId);
      if (!s) return;

      if (envExports) s.pty.write(envExports + '\r');
      s.pty.write(`cd "${cwd}"\r`);

      if (initialPrompt) {
        const tmpFile = writePromptTempFile(initialPrompt, sessionId);
        const argsStr = baseArgs.join(' ');
        s.pty.write(`${baseCommand}${argsStr ? ` ${argsStr}` : ''} "$(cat '${tmpFile}')"\r`);
        setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 2000);
      } else {
        const agentCmd = [baseCommand, ...baseArgs].join(' ');
        s.pty.write(`${agentCmd}\r`);
      }
    }, 500);

    return { sessionId, mode: 'pty', pid: session.pty.pid };
  }
}

// Send text to a live session. Enter is sent as a separate write after a short delay
// because many TUI inputs (Claude Code, Codex) need Enter as its own event.
export async function sendToAgent(sessionId: string, mode: 'tmux' | 'pty', text: string): Promise<void> {
  if (mode === 'tmux') {
    const tmux = new TmuxManager(sessionId);
    // Send text without Enter first, then Enter after 900ms
    await tmux.sendKeys(text, false);
    await new Promise(r => setTimeout(r, 900));
    await tmux.sendKeys('', true);  // just Enter
  } else {
    const s = getPtySession(sessionId);
    if (!s) return;
    s.pty.write(text);
    // Separate Enter after 900ms
    setTimeout(() => {
      const ss = getPtySession(sessionId);
      if (ss) ss.pty.write('\r');
    }, 900);
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

// Deploy a Stop hook for Claude Code so it calls back to Plangent when the agent stops.
// The command is generic: it reads PLANGENT_PROJECT_ID / PLANGENT_TASK_ID /
// PLANGENT_RUN_ID from the agent's own environment (exported before launch), so a
// single hook serves every run in this repo — sequential or parallel — and one run
// stopping never tears down the hook for its siblings.
export function deployClaudeStopHook(
  repoCwd: string,
  callbackUrl: string,
): void {
  const settingsDir = path.join(repoCwd, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');
  fs.mkdirSync(settingsDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
  }

  const hookCmd = `curl -s -X POST "${callbackUrl}/api/projects/$PLANGENT_PROJECT_ID/tasks/$PLANGENT_TASK_ID/runs/$PLANGENT_RUN_ID/agent-stopped" -H "Content-Type: application/json" -d "{\\"runId\\":\\"$PLANGENT_RUN_ID\\"}" || true`;

  const hookEntry = {
    matcher: '',
    hooks: [{ type: 'command', command: hookCmd }],
  };

  const hooks = (existing.hooks as Record<string, unknown[]> | undefined) ?? {};
  const stopHooks: unknown[] = (hooks['Stop'] as unknown[] | undefined) ?? [];

  // Remove any previous plangent hook, then add current
  const filtered = stopHooks.filter(
    (h: unknown) => {
      const hh = h as { hooks?: Array<{ command?: string }> };
      return !hh.hooks?.some(inner => inner.command?.includes('plangent'));
    }
  );
  filtered.push(hookEntry);
  hooks['Stop'] = filtered;

  const updated = { ...existing, hooks };
  fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
}

// Remove the Stop hook Plangent added.
export function cleanupClaudeStopHook(repoCwd: string): void {
  const settingsPath = path.join(repoCwd, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const hooks = existing.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return;
    const stopHooks = (hooks['Stop'] as unknown[]) ?? [];
    const filtered = stopHooks.filter(
      (h: unknown) => {
        const hh = h as { hooks?: Array<{ command?: string }> };
        return !hh.hooks?.some(inner => inner.command?.includes('plangent'));
      }
    );
    if (filtered.length === 0) delete hooks['Stop'];
    else hooks['Stop'] = filtered;
    if (Object.keys(hooks).length === 0) delete existing.hooks;
    const newContent = JSON.stringify(existing, null, 2);
    if (newContent === '{}') {
      fs.unlinkSync(settingsPath);
    } else {
      fs.writeFileSync(settingsPath, newContent, 'utf-8');
    }
  } catch {}
}
