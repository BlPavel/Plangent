import { createPtySession, killPtySession, getPtySession } from '../terminal/pty-manager';
import { TmuxManager } from '../terminal/tmux';
import { Agent } from '../../models';
import { LaunchResult, RunContext } from '../../core/orchestration/agent-runtime';
import { PLAN_PROTOCOL_LOCKED } from '../../core/library/plan-template';
import fs from 'fs';
import path from 'path';

// Planning-mode prompt: ONLY teaches how to write the plan and tells the agent to
// wait for the developer to describe the task. It deliberately does NOT frame the
// task as something to execute — the developer drives the conversation in the terminal.
function buildPlanningPrompt(ctx: RunContext): string {
  const lines: string[] = [];
  const planPath = ctx.planFilePath ? `\`${ctx.planFilePath}\`` : 'the plan file';
  const template = (ctx.planTemplate ?? '').trim();

  if (template) {
    lines.push(template);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  lines.push(PLAN_PROTOCOL_LOCKED.trim());
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

function buildPreflightPrompt(ctx: RunContext): string {
  const lines: string[] = [];
  const planPath = ctx.planFilePath ? `\`${ctx.planFilePath}\`` : 'the plan file';

  lines.push(PLAN_PROTOCOL_LOCKED.trim());
  lines.push('');
  lines.push('## You are in PREFLIGHT mode');
  lines.push(`# Task: ${ctx.taskKey}${ctx.taskTitle ? ` — ${ctx.taskTitle}` : ''}`);
  lines.push(`Project: ${ctx.projectName}`);
  lines.push('');

  if (ctx.taskDescription) {
    lines.push('## Description');
    lines.push(ctx.taskDescription);
    lines.push('');
  }

  if (ctx.points && ctx.points.length > 0) {
    lines.push('## Steps to study');
    lines.push('Study these plan step ids only:');
    for (const p of ctx.points) {
      lines.push(`- \`${p}\``);
    }
    lines.push('');
  }

  lines.push('## Rules');
  lines.push('- Read files and inspect the codebase as needed.');
  lines.push('- Do NOT modify source code, configs, tests, migrations, or generated app files.');
  lines.push('- Do NOT mark any plan checkbox as complete during preflight.');
  lines.push(`- You MAY update ${planPath} only when the developer asks you to refine the plan.`);
  lines.push('- When editing existing plan steps, preserve assigned `(pN)` ids whenever possible.');
  lines.push('- If a step must be split or replaced, keep the original id as a parent/checkpoint or clearly tell the developer to reselect execution steps.');
  lines.push('- End with your execution approach, risks, open questions, and whether the selected steps are ready to execute.');
  lines.push('- After that, stop and wait for the developer.');
  lines.push('');

  if (ctx.planContent) {
    lines.push('## Current plan');
    lines.push('```');
    lines.push(ctx.planContent);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

export function buildPrompt(ctx: RunContext): string {
  if (ctx.purpose === 'plan') return buildPlanningPrompt(ctx);
  if (ctx.purpose === 'preflight') return buildPreflightPrompt(ctx);

  const lines: string[] = [];

  lines.push(PLAN_PROTOCOL_LOCKED.trim());
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

const isWindows = process.platform === 'win32';

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

function shellCommand(command: string, args: string[]): string {
  if (isWindows) {
    const parts = [psQuote(command), ...args.map(psQuote)].join(' ');
    return `& ${parts}`;
  }
  return [shQuote(command), ...args.map(shQuote)].join(' ');
}

function envAssignments(env: Record<string, string>, separator: string): string {
  if (isWindows) {
    return Object.entries(env)
      .map(([k, v]) => `[Environment]::SetEnvironmentVariable(${psQuote(k)}, ${psQuote(v)}, 'Process')`)
      .join(separator);
  }
  return Object.entries(env)
    .map(([k, v]) => `export ${k}=${shQuote(v)}`)
    .join(separator);
}

function cdCommand(cwd: string): string {
  return isWindows ? `Set-Location -LiteralPath ${psQuote(cwd)}` : `cd ${shQuote(cwd)}`;
}

// Substitutes {model}/{reasoning}-style placeholders in an agent's args template.
// When a placeholder's value is empty, the token is dropped entirely, along with
// the preceding flag token if that token looks like a separate `--flag value` pair
// (e.g. ["--model", "{model}"] -> both removed; "-c foo={reasoning}" -> both removed;
// but a value embedded with other literal text is only dropped if that text resolves empty).
function applyAgentPlaceholders(args: string[], values: Record<string, string>): string[] {
  const result: string[] = [];
  for (const arg of args) {
    let substituted = arg;
    let missing = false;
    for (const [key, val] of Object.entries(values)) {
      const placeholder = `{${key}}`;
      if (substituted.includes(placeholder)) {
        if (!val) missing = true;
        substituted = substituted.split(placeholder).join(val);
      }
    }
    if (missing) {
      if (result.length && result[result.length - 1].startsWith('-') && !arg.startsWith('-')) {
        result.pop();
      }
      continue;
    }
    result.push(substituted);
  }
  return result;
}

function defaultShell(): { command: string; args: string[] } {
  if (isWindows) {
    return { command: process.env.SHELL || 'powershell.exe', args: ['-NoLogo'] };
  }
  return { command: process.env.SHELL || '/bin/zsh', args: ['-l'] };
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

  // Start the agent first, then enter the initial prompt through its terminal input.
  // Passing a prompt as a command-line argument exceeds Windows' command-length limit
  // for sufficiently large plans or task descriptions.
  const baseCommand = agent.command;
  const baseArgs = applyAgentPlaceholders(agent.args, {
    model: agent.model ?? '',
    reasoning: agent.reasoning_effort ?? '',
  });

  if (TmuxManager.isTmuxAvailable()) {
    const tmux = new TmuxManager(sessionId);
    const envStr = envAssignments(agentEnv, ' && ');

    await tmux.create();
    if (envStr) await tmux.sendKeys(envStr);
    await tmux.sendKeys(cdCommand(cwd));

    if (initialPrompt) {
      await tmux.sendKeys(shellCommand(baseCommand, baseArgs));
      // Give interactive CLIs time to initialize before writing to their stdin.
      setTimeout(() => { void tmux.sendInput(initialPrompt); }, 1000);
    } else {
      await tmux.sendKeys(shellCommand(baseCommand, baseArgs));
    }

    return { sessionId, mode: 'tmux' };
  } else {
    const shell = defaultShell();
    const session = createPtySession(sessionId, shell.command, shell.args, cwd, agentEnv);

    const envExports = envAssignments(agentEnv, '\n');

    setTimeout(() => {
      const s = getPtySession(sessionId);
      if (!s) return;

      if (envExports) s.pty.write(envExports + '\r');
      s.pty.write(`${cdCommand(cwd)}\r`);

      if (initialPrompt) {
        s.pty.write(`${shellCommand(baseCommand, baseArgs)}\r`);
        // Write the prompt after the TUI is ready. Keep Enter separate because
        // Claude Code and Codex treat it as a distinct terminal event.
        setTimeout(() => {
          const readySession = getPtySession(sessionId);
          if (!readySession) return;
          readySession.pty.write(initialPrompt);
          setTimeout(() => {
            const currentSession = getPtySession(sessionId);
            if (currentSession) currentSession.pty.write('\r');
          }, 900);
        }, 1000);
      } else {
        s.pty.write(`${shellCommand(baseCommand, baseArgs)}\r`);
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
