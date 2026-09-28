import { PLAN_PROTOCOL_LOCKED } from '../library/plan-template';
export interface RunContext {
  projectName: string;
  taskKey: string;
  taskTitle?: string;
  taskDescription?: string;
  planContent?: string;
  planFilePath?: string;
  planTemplate?: string;
  points?: string[];
  purpose?: 'plan' | 'execute' | 'preflight';
  runHistory: Array<{
    agent: string;
    date: string;
    completed: string[];
    notes?: string;
  }>;
}

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


export const EXECUTION_REPORT = '\nWhen all assigned steps are done, call the Plangent MCP complete_step tool with a summary. If blocked, call request_help. Do not rely on plan checkboxes as completion signals.';
