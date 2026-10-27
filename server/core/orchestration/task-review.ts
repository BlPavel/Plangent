import type { Agent, OrchestratorQueueSession, TaskQueue } from '../../models';
import type { AgentSession } from '../agent-sessions/types';
import { createSession, getSession, listSessions, updateSession } from '../agent-sessions/sessions';
import { sendPrompt } from '../agent-sessions/acp-host';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { createRun, listRuns } from '../runs';
import { getLatestPlan } from './plans';
import { analysisToolContext } from './analysis-context';
import { repositoryInfo, taskWorktreeChanges } from '../code/git';
import { reviews } from '../code-reviews/reviews';
import { resolveReviewSkill } from '../library/review-skill';
import { getOrchestrator } from './orchestrator';
import { isActive, saveQueue } from './queue';
import { CodeError } from '../code/files';

export const TASK_REVIEW_PROTOCOL = [
  'You are a task reviewer. Read files and run read-only commands only. Never edit files or change Git state.',
  'Call get_task_review_brief first. Follow the selected review skill. Review implementation against the task, analysis, plan and executor reports, including failed/skipped work.',
  'The captured diff spans the task baseline to the worktree at launch, including committed, staged, unstaged and untracked changes. Other work may share the branch: report only problems related to this task.',
  'Read existing branch review items and threads. Do not duplicate them, including dismissed or already addressed findings, without new evidence.',
  'Use add_task_remark for actionable findings: scope line/file/general, kind fix/question, text, file and optional line_start/line_end. Lines refer to the current worktree, never old-side lines. Invalid lines become file remarks.',
  'Finish with submit_task_review and a short summary, even when there are no findings. Findings are agent drafts in Code; the queue continues without waiting for their resolution.',
];

function scope(session: AgentSession) {
  const orch = session.task_id ? getOrchestrator(session.task_id) : undefined;
  const item = orch?.sessions().find(s => s.kind === 'review' && s.sessionId === session.id);
  if (session.role !== 'task-reviewer' || session.policy !== 'read-only' || !orch || !item || !isActive(item)
    || orch.queue.projectId !== session.project_id) throw new CodeError('No active task review', 403);
  return { orch, item };
}

export function taskReviewCount(sessionId: string): number {
  const ids = getSession(sessionId).metadata.task_review_items;
  return Array.isArray(ids) ? ids.length : 0;
}

export async function launchTaskReview(queue: TaskQueue, item: OrchestratorQueueSession, agent: Agent, save: () => void) {
  const task = getTask(queue.taskId)!, project = getProject(queue.projectId)!;
  const repository = await repositoryInfo(project.repo_path);
  const changes = repository && task.base_commit ? await taskWorktreeChanges(project.repo_path, task.base_commit) : null;
  // A stop may arrive while Git is collecting the context.
  if (queue.status !== 'running' || item.status !== 'reviewing') return;
  const plan = getLatestPlan(task.id);
  const run = createRun({ task_id: task.id, plan_id: plan?.id, agent_id: agent.id, agent_name: agent.name });
  const session = createSession({ project_id: project.id, task_id: task.id, run_id: run.id,
    agent_id: agent.id, model: agent.model, role: 'task-reviewer', policy: 'read-only', title: task.key + ' · Ревью',
    metadata: { reasoningEffort: agent.reasoning_effort, briefing: TASK_REVIEW_PROTOCOL.join('\n'),
      task_review_repository: repository, task_review_changes: changes, task_review_items: [],
      task_review_skill: resolveReviewSkill(project.id, item.skillId) } });
  item.runId = run.id; item.sessionId = session.id; item.mode = 'acp';
  save();
  await sendPrompt(session.id, [{ type: 'text', text: 'Вызови get_task_review_brief, проверь выполнение задачи, сохрани замечания через add_task_remark и заверши submit_task_review.' }]);
}

export async function taskReviewBrief(session: AgentSession) {
  const { orch } = scope(session);
  const task = getTask(session.task_id!)!, project = getProject(session.project_id)!;
  const current = await reviews().current(project.id);
  return { protocol: TASK_REVIEW_PROTOCOL, task, plan: getLatestPlan(task.id)?.content ?? '',
    analysis: analysisToolContext(task.id, project.repo_path, task.key),
    skill: session.metadata.task_review_skill,
    range: { base: task.base_commit, repository: session.metadata.task_review_repository, captured_at: session.created_at },
    changes: session.metadata.task_review_changes,
    limitation: session.metadata.task_review_changes === null
      ? 'Нет Git или начального коммита задачи. Дифф недоступен. Проверяйте файлы по отчётам исполнителей и плану; не утверждайте, что просмотрели полный дифф.' : null,
    runs: listRuns(task.id),
    executor_reports: listSessions(project.id).filter(s => s.task_id === task.id && s.role === 'executor')
      .map(s => ({ id: s.id, steps: s.step_ids, status: s.status, summary: s.reason })),
    queue: [...orch.queue.stages, ...(orch.queue.history ?? []).flatMap(r => r.stages)],
    existing_review: { review: current.review, items: current.items, messages: current.messages } };
}

export async function addTaskRemark(session: AgentSession, input: Record<string, unknown>) {
  scope(session);
  const project = getProject(session.project_id)!;
  const captured = session.metadata.task_review_repository as Awaited<ReturnType<typeof repositoryInfo>>;
  const now = await repositoryInfo(project.repo_path);
  if (captured?.branch !== now?.branch || (!captured?.branch && captured?.head !== now?.head))
    throw new CodeError('Review branch changed; restart the review', 409);
  const result = await reviews().addAgentDraft(session.project_id, session.task_id!, {
    scope: input.scope as 'line' | 'file' | 'general', kind: input.kind as 'fix' | 'question', text: input.text as string,
    file: input.file as string | undefined, line_start: input.line_start as number | undefined, line_end: input.line_end as number | undefined,
  });
  // Preserve the session's current metadata when several tool calls run concurrently.
  const fresh = getSession(session.id);
  const ids = Array.isArray(fresh.metadata.task_review_items) ? fresh.metadata.task_review_items : [];
  updateSession(session.id, { metadata: { ...fresh.metadata, task_review_items: [...ids, result.item.id] } });
  const { orch, item } = scope(session);
  item.reviewId = result.review.id; item.remarks = ids.length + 1;
  saveQueue(orch.queue);
  return result;
}

export async function submitTaskReview(session: AgentSession, summary: unknown) {
  const { orch } = scope(session);
  if (typeof summary !== 'string' || !summary.trim()) throw new CodeError('Summary required');
  updateSession(session.id, { status: 'complete', reason: summary.trim() });
  await orch.onChatTurnEnd(session.id);
  return { completed: true, remarks: taskReviewCount(session.id) };
}
