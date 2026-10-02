import { analysisToolContext, selectedAnalysisContext } from './analysis-context';
import { PLAN_PROTOCOL_LOCKED } from '../library/plan-template';
/** Hidden librarian instructions; the authoring guide itself comes from get_library. */
export function buildLibrarianPrompt(projectName: string): string {
  return [
    '[Plangent] You are the librarian for project ' + projectName + '.',
    'Start by calling get_library for existing instructions, the authoring guide and available levels. Follow that guide.',
    'Read suitable existing items with get_library_item before deciding whether to update one or create a new item.',
    'Read project code for accurate examples. Choose the instruction type and availability from the request and guide; ask only when an answer is needed for that choice.',
    'Submit changes only with propose_library_change. Do not write project, library or synchronized agent files, and do not run commands that modify them.',
    'For a shared group item, propose a separate project copy; do not change the shared original.',
    'After submitting, briefly explain your choice and wait for feedback. The developer applies or rejects proposals.',
    '',
    "Developer's message:",
  ].join('\n');
}

export interface RunContext {
  projectName: string;
  taskKey: string;
  taskTitle?: string;
  taskDescription?: string;
  planContent?: string;
  planFilePath?: string;
  planTemplate?: string;
  points?: string[];
  taskId?: string;
  repoPath?: string;
  purpose?: 'analysis' | 'plan' | 'execute' | 'preflight';
  runHistory: Array<{
    agent: string;
    date: string;
    completed: string[];
    notes?: string;
  }>;
}

/**
 * Planner briefing. It travels with the developer's first message and is hidden in the chat, so it
 * stays short: the plan, template and format rules come from the get_plan tool, and submit_plan
 * checks the format instead of the prompt spelling it out.
 */
function buildPlanningPrompt(ctx: RunContext): string {
  return [
    `[Plangent] You are the planner for task \`${ctx.taskKey}\`${ctx.taskTitle ? ` (${ctx.taskTitle})` : ''} in project ${ctx.projectName}.`,
    'Your job is a plan, not the implementation: read the code as much as you need, but do not edit files or run commands that change anything.',
    ctx.planContent
      ? 'A plan already exists. Call the Plangent tool get_plan to read it, then change it as the developer asks below.'
      : 'Call the Plangent tool get_plan for the plan template and format, then plan the task the developer describes below.',
    'Use get_plan analysis groups: prefer worked sections; consult source materials for details. Reference materials on step lines as [[section]] or [[section/file]]. If analysis is empty, plan as usual.',
    'Save the plan only with the Plangent tool submit_plan (the full plan every time) - never write the plan file yourself.',
    'After submitting, summarize the plan in a few lines and wait for the developer\'s feedback. Do not start executing.',
    '',
    'Developer\'s message:',
  ].join('\n');
}

/** What get_plan returns to the planner. */
export function planningToolContext(ctx: RunContext): Record<string, unknown> {
  return {
    task: { key: ctx.taskKey, title: ctx.taskTitle ?? '', description: ctx.taskDescription ?? '' },
    project: ctx.projectName,
    ...(ctx.taskId && ctx.repoPath ? { analysis: analysisToolContext(ctx.taskId, ctx.repoPath, ctx.taskKey) } : {}),
    currentPlan: ctx.planContent || null,
    template: ctx.planTemplate?.trim() || null,
    format: PLAN_PROTOCOL_LOCKED.trim(),
  };
}

export function buildAnalysisPrompt(ctx: RunContext): string {
  return [
    '[Plangent] You are the analyst for task ' + ctx.taskKey + ' in project ' + ctx.projectName + '.',
    'Start with the Plangent tool get_analysis. Read the sections and attachments as needed.',
    'Save results promptly with save_section in as many worked sections as needed; new sections have author agent.',
    'Only edit developer materials or create/edit source sections when explicitly requested by the developer; set source_requested=true only for that request.',
    'Mention project files by path; do not copy them into analysis. Do not edit project files or write analysis files directly.',
    'Do not create or change the plan. Summarize the saved sections with their [[slug]] links in your reply.',
    '', "Developer's message:",
  ].join('\n');
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
  if (ctx.purpose === 'analysis') return buildAnalysisPrompt(ctx);
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
    lines.push('Do not work on steps outside this list. Do not edit the plan file: Plangent checks the steps off itself when you call complete_step.');
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

  const materials = ctx.taskId && ctx.repoPath
    ? selectedAnalysisContext(ctx.taskId, ctx.repoPath, ctx.taskKey, ctx.planContent ?? '', ctx.points) : '';
  if (materials) lines.push('## Материалы анализа', materials, '');

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

/** Hidden reviewer briefing; the visible message only lists the steps to check. */
export const REVIEW_BRIEFING = '[Plangent] You review the changes made for the plan steps listed below. Do not edit files. Use get_review_context, inspect the files, report actionable findings with add_finding and finish with submit_review (approved or changes_requested).';

/** Review findings handed back to the executor, readable in the chat. */
export function reviewFixMessage(findings: Record<string, unknown>[]): string {
  const lines = findings.map(f => `- ${f.file}:${f.line} — ${f.message}`);
  return `Ревью нашло замечания — исправь их:\n${lines.join('\n') || '- (без подробностей, см. ревью)'}\n\nКогда закончишь, снова отчитайся через complete_step.`;
}
