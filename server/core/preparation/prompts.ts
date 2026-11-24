import { analysisToolContext } from './analysis-context';
import { parsePlanSteps } from './plans';
import { getReadyMaterials } from './materials/stages';
import { getLatestMaterial, parseMaterialIdentifiers } from './materials';
import { PLAN_PROTOCOL_LOCKED } from '../library';
import { REVIEW_SKILL_AUTHORING } from '../library';
import { PLAN_REVIEW_SKILL_AUTHORING } from '../library';
import { MATERIAL_KINDS } from './materials/kinds';
/** Hidden librarian instructions; the authoring guide itself comes from get_library. */
export function buildLibrarianPrompt(projectName: string): string {
  return [
    '[Plangent] You are the librarian for project ' + projectName + '.',
    'Start by calling get_library for existing instructions, the authoring guide and available levels. Follow that guide.',
    'Read suitable existing items with get_library_item before deciding whether to update one or create a new item.',
    'Read project code for accurate examples. Choose the instruction type and availability from the request and guide; ask only when an answer is needed for that choice.',
    'Submit changes only with propose_library_change. Do not write project, library or synchronized agent files, and do not run commands that modify them.',
    'For a shared group item, propose a separate project copy; do not change the shared original.',
    'Text instructions (instruction guide, code-fixer instruction, commit rules, plan template, review and interview instructions, material templates) are one text per level: read the one in force with get_instruction_text, then propose an update with its item_id, or a create when item_id is null. Their slug is fixed. Review, interview and plan-review instructions are global only. When the developer asks to change a global text, use scope global.',
    'After submitting, briefly explain your choice and wait for feedback. The developer applies or rejects proposals.',
    REVIEW_SKILL_AUTHORING,
    PLAN_REVIEW_SKILL_AUTHORING,
    MATERIAL_KINDS.architecture.reviewSkillAuthoring,
    MATERIAL_KINDS.qa.reviewSkillAuthoring,
    '',
    "Developer's message:",
  ].join('\n');
}

export interface TaskAgentContext {
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
  analysisRepoPath?: string;
  purpose?: 'analysis' | 'plan' | 'execute' | 'preflight' | 'architecture' | 'qa';
}

/**
 * Planner briefing. It travels with the developer's first message and is hidden in the chat, so it
 * stays short: the plan, template and format rules come from the get_plan tool, and submit_plan
 * checks the format instead of the prompt spelling it out.
 */
function buildPlanningPrompt(ctx: TaskAgentContext): string {
  return [
    `[Plangent] You are the planner for task \`${ctx.taskKey}\`${ctx.taskTitle ? ` (${ctx.taskTitle})` : ''} in project ${ctx.projectName}.`,
    'Prepare an implementation plan for the task unless the developer explicitly requests a different deliverable. Read the code as needed. Do not edit files or run commands that modify them.',
    ctx.planContent
      ? 'A plan already exists. Call the Plangent tool get_plan to read it, then change it as the developer asks below.'
      : 'Call the Plangent tool get_plan for task details, preparation materials and planning instructions before drafting.',
    'Save the plan only with the Plangent tool submit_plan (the full plan every time) - never write the plan file yourself.',
    'After submitting, summarize the plan in a few lines and wait for the developer\'s feedback. Do not start executing.',
    '',
    'Developer\'s message:',
  ].join('\n');
}

const PLANNER_MATERIAL_GUIDANCE = [
  'A request to write a plan based on the analysis calls for concrete steps to implement the task and checks for the resulting behavior. Plan research or documentation as the deliverable only if the developer explicitly asks for it.',
  'Analysis is the initial preparation stage. Use worked analysis sections and consult source materials for details. If analysis is empty, use the remaining task context and the code.',
  'Ready architecture describes the target design and takes precedence over analysis where they disagree about the design. Ready QA defines acceptance criteria and takes precedence over analysis where they disagree about expected behavior or verification. Use analysis for details these documents leave open.',
  'If ready architecture and ready QA conflict in a way that changes implementation or acceptance, ask the developer to resolve the conflict before finalizing the plan.',
].join('\n');

/** Ready architecture and QA ground the plan; drafts and skipped ones are named so the planner can tell the developer. */
function materialsForPlanner(taskId: string): Record<string, unknown> {
  const ready = getReadyMaterials(taskId);
  const ground = (type: 'architecture' | 'qa') => ready[type]
    ? { version: ready[type]!.version, content: ready[type]!.content, identifiers: parseMaterialIdentifiers(ready[type]!.content) } : null;
  const unused = (['architecture', 'qa'] as const).filter(type => !ready[type] && getLatestMaterial(taskId, type));
  return { architecture: ground('architecture'), qa: ground('qa'),
    ...(unused.length ? { materialsNotUsed: unused.map(type => type + ': not marked ready by the developer, do not rely on it') } : {}) };
}

/** What get_plan returns to the planner. */
export function planningToolContext(ctx: TaskAgentContext): Record<string, unknown> {
  return {
    task: { key: ctx.taskKey, title: ctx.taskTitle ?? '', description: ctx.taskDescription ?? '' },
    project: ctx.projectName,
    ...(ctx.taskId && ctx.repoPath ? { analysis: analysisToolContext(ctx.taskId, ctx.analysisRepoPath ?? ctx.repoPath, ctx.taskKey) } : {}),
    ...(ctx.taskId ? materialsForPlanner(ctx.taskId) : {}),
    currentPlan: ctx.planContent || null,
    template: ctx.planTemplate?.trim() || null,
    format: `${PLAN_PROTOCOL_LOCKED.trim()}\n\n${PLANNER_MATERIAL_GUIDANCE}`,
  };
}

export function buildAnalysisPrompt(ctx: TaskAgentContext): string {
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

/** A short pointer: the document, template and rules arrive only through get_material. */
export function buildMaterialPrompt(ctx: TaskAgentContext, material: 'architecture' | 'qa'): string {
  return [
    '[Plangent] You are the author of the ' + (material === 'qa' ? 'QA' : 'architecture') + ' document for task ' + ctx.taskKey + ' in project ' + ctx.projectName + '. You are read-only.',
    'Start with the Plangent tool get_material: it gives the task, analysis, the current document, how to write it and the format rules.',
    'Save the document only with the Plangent tool submit_material (the full text every time) - never write files yourself. Do not mark the section ready: the developer does that.',
    'Do not change the plan or the analysis. After saving, briefly say what you wrote and wait for the developer.',
    '', "Developer's message:",
  ].join('\n');
}

function buildPreflightPrompt(ctx: TaskAgentContext): string {
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

export function buildPrompt(ctx: TaskAgentContext): string {
  if (ctx.purpose === 'analysis') return buildAnalysisPrompt(ctx);
  if (ctx.purpose === 'plan') return buildPlanningPrompt(ctx);
  if (ctx.purpose === 'architecture' || ctx.purpose === 'qa') return buildMaterialPrompt(ctx, ctx.purpose);
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

  // Materials the steps link to arrive through the tool, not through the prompt.
  const linked = ctx.planContent && parsePlanSteps(ctx.planContent)
    .some(s => (!ctx.points || !ctx.points.length || (s.id && ctx.points.includes(s.id))) && (s.analysisLinks ?? []).length);
  if (linked) lines.push('## Materials', 'The steps link to materials ([[…]]). Before starting, call the Plangent tool get_step_context to retrieve them.', '');


  return lines.join('\n');
}


export const EXECUTION_REPORT = '\nWhen all assigned steps are done, call the Plangent MCP complete_step tool with a summary. If blocked, call request_help. Do not rely on plan checkboxes as completion signals.';
