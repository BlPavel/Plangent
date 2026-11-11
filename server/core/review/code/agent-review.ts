import type { CodeReviewLaunch } from '@contracts';
import { createAgentSession, getAgent, getSession, listSessions, markAgentWorkFinished, updateSession } from '../../agents';
import type { AgentSession } from '../../agents';
import { getProject } from '../../projects';
import { reviewAgent } from '../../settings';
import { rootForWorkspace } from '../../workspaces';
import { readCodeFile } from '../../files';
import { resolveMrReviewInstruction, resolveReviewSkill } from '../../library';
import { DomainError } from '../../../models/domain-error';
import { diffFile, oldFile, repositoryInfo, reviewBase, snapshot, taskWorktreeChanges, treeChanges } from '../../../infrastructure/git/read';
import { sendReviewBatch } from '../kernel';
import { reviews } from './reviews';

const protocol = [
  'You are a code reviewer. Read files and run read-only commands only. Never edit files or change Git state.',
  'Call get_task_review_brief first. It contains the selected Code review range, a captured diff, review instruction, skill, the developer context (developer_context: follow it, look closely where it points) and existing discussions.',
  'Review only problems introduced by the captured changes. Read surrounding code as context. Do not duplicate existing findings, including rejected or resolved ones, without new evidence.',
  'Use add_task_remark for actionable findings: scope line/file/general, kind fix/question, text, file, optional line_start/line_end. Lines refer to the new side at launch. For deleted files use file remarks.',
  'Finish with submit_task_review and a short summary even when there are no findings. Findings are drafts for the developer to decide and send for fixing.',
];

function inputFor(input: CodeReviewLaunch) {
  if (!input || !['worktree', 'branch'].includes(input.mode)) throw new DomainError('Выберите область ревью');
  if (input.mode === 'branch' && (typeof input.ref !== 'string' || !input.ref.trim())) throw new DomainError('Выберите ветку для сравнения');
  for (const key of ['agent_id', 'model', 'skill_id', 'effort', 'context'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new DomainError('Invalid ' + key);
  }
  if (input.config !== undefined && (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)
    || Object.values(input.config).some(value => typeof value !== 'string'))) throw new DomainError('Invalid config');
  return input;
}

async function context(projectId: string, input: CodeReviewLaunch, workspaceId?: string) {
  inputFor(input);
  if (getProject(projectId)?.kind !== 'project') throw new DomainError('Проект не найден', 404);
  const root = rootForWorkspace(projectId, workspaceId);
  const info = await repositoryInfo(root);
  if (!info) throw new DomainError('Для ревью нужен Git-репозиторий');
  const base = await reviewBase(root, input.mode === 'branch' ? input.ref : undefined).catch(error => {
    const message = error instanceof Error && /Ветка не найдена|первый коммит/.test(error.message)
      ? error.message : 'Не удалось определить общую базу для ревью';
    throw new DomainError(message);
  });
  return { root, info, base };
}

export async function previewCodeReview(projectId: string, input: CodeReviewLaunch, workspaceId?: string) {
  const { root, info, base } = await context(projectId, input, workspaceId);
  const changes = await taskWorktreeChanges(root, base);
  return { base, branch: info.branch, files: changes.map(change => change.file) };
}

// Covers context collection and delivery, so two starts cannot pass through the ready-session gap.
const launching = new Set<string>();
export async function launchCodeReview(projectId: string, input: CodeReviewLaunch, workspaceId?: string) {
  const key = projectId;
  if (launching.has(key)) throw new DomainError('Ревью уже запускается', 409);
  launching.add(key);
  let session: AgentSession | undefined;
  try {
    const { root, info, base } = await context(projectId, input, workspaceId);
    const configured = reviewAgent(projectId, { agentId: input.agent_id, model: input.model, effort: input.effort });
    const agent = getAgent(configured.agentId);
    if (!agent) throw new DomainError('Агент не найден');
    const tree = await snapshot(root);
    if (!tree) throw new DomainError('Не удалось сохранить состояние для ревью');
    const { changes } = await treeChanges(root, base, tree);
    if (!changes.length) throw new DomainError('В выбранной области нет изменений');
    const captured = await Promise.all(changes.map(async change => ({ file: change.path,
      diff: await diffFile(root, change.path, { base, end: tree, originalPath: change.originalPath }) })));
    session = createAgentSession({ project_id: projectId, agent_id: agent.id,
      model: configured.model || agent.model,
      config: input.config, role: 'task-reviewer', policy: 'read-only', title: 'Код · Ревью',
      metadata: { workspace_id: workspaceId, code_review: true, briefing: protocol.join('\n'),
        reasoningEffort: configured.effort || agent.reasoning_effort,
        task_review_independent: true, task_review_active: true, task_review_items: [],
        task_review_repository: info, task_review_changes: captured, task_review_skill: input.skill_id === '' ? null : resolveReviewSkill(projectId, input.skill_id),
        task_review_context: input.context?.trim().slice(0, 20000) || null,
        code_review_range: { mode: input.mode, ref: input.mode === 'branch' ? input.ref : undefined, base, tree },
      } });
    const round = await reviews(workspaceId).startAgentRound(projectId, undefined, session.id, { info, tree });
    updateSession(session.id, { metadata: { ...getSession(session.id).metadata, task_review_round: round.id, code_review_id: round.review_id } });
    await sendReviewBatch(session.id, 'Call get_task_review_brief to review the selected Code changes, save findings with add_task_remark, and finish with submit_task_review. Write for the developer in their language, Russian by default.');
    return getSession(session.id);
  } catch (error) {
    if (session) {
      updateSession(session.id, { status: 'error', reason: String(error), metadata: { ...getSession(session.id).metadata, task_review_active: false } });
      markAgentWorkFinished(session.id);
    }
    throw error;
  } finally { launching.delete(key); }
}

async function scoped(session: AgentSession) {
  const fresh = getSession(session.id);
  if (fresh.role !== 'task-reviewer' || fresh.policy !== 'read-only' || !fresh.metadata.code_review
    || !fresh.metadata.task_review_active || fresh.project_id !== session.project_id) throw new DomainError('No active code review', 403);
  const workspaceId = fresh.metadata.workspace_id as string | undefined;
  const root = rootForWorkspace(fresh.project_id, workspaceId);
  const service = reviews(workspaceId);
  const detail = await service.detail(fresh.project_id, String(fresh.metadata.code_review_id));
  if (detail.read_only || !detail.rounds.some(round => round.id === fresh.metadata.task_review_round && round.session_id === fresh.id))
    throw new DomainError('Review changed; restart the review', 409);
  const now = await repositoryInfo(root);
  const captured = fresh.metadata.task_review_repository as Awaited<ReturnType<typeof repositoryInfo>>;
  if (captured?.branch !== now?.branch || captured?.head !== now?.head) throw new DomainError('Review branch or HEAD changed; restart the review', 409);
  return { fresh, root, service, detail };
}

export async function codeReviewBrief(session: AgentSession) {
  const { fresh, detail } = await scoped(session);
  return { protocol, instruction: resolveMrReviewInstruction(), skill: fresh.metadata.task_review_skill, developer_context: fresh.metadata.task_review_context ?? null,
    range: { ...(fresh.metadata.code_review_range as object), captured_at: fresh.created_at, repository: fresh.metadata.task_review_repository },
    changes: fresh.metadata.task_review_changes,
    rounds: detail.rounds,
    previous_reports: listSessions(fresh.project_id).filter(s => detail.rounds.some(round => round.session_id === s.id))
      .map(s => ({ id: s.id, status: s.status, summary: s.reason })),
    existing_review: { review: detail.review, items: detail.items, messages: detail.messages } };
}

export async function addCodeRemark(session: AgentSession, input: Record<string, unknown>) {
  const { fresh, root, service } = await scoped(session);
  if (input.scope === 'line' && typeof input.file === 'string') {
    const range = fresh.metadata.code_review_range as { tree: string };
    const captured = await oldFile(root, input.file, range.tree).catch(() => null);
    const current = await readCodeFile(root, input.file).then(file => file.content ?? null).catch(() => null);
    // The snapshot goes through Git, which may normalize line endings (core.autocrlf), while the file on disk keeps CRLF.
    const plain = (text: string | null) => text?.replace(/\r\n/g, '\n') ?? null;
    if (plain(captured) !== plain(current)) throw new DomainError('Файл изменился после запуска ревью; запустите проверку заново', 409);
  }
  const result = await service.addAgentDraft(fresh.project_id, undefined, {
    scope: input.scope as 'line' | 'file' | 'general', kind: input.kind as 'fix' | 'question', text: input.text as string,
    file: input.file as string | undefined, line_start: input.line_start as number | undefined, line_end: input.line_end as number | undefined,
  }, { reviewId: String(fresh.metadata.code_review_id), roundId: String(fresh.metadata.task_review_round), sessionId: fresh.id });
  const latest = getSession(fresh.id);
  const ids = latest.metadata.task_review_items as string[];
  updateSession(fresh.id, { metadata: { ...latest.metadata, task_review_items: [...ids, result.item.id] } });
  return result;
}

export async function submitCodeReview(session: AgentSession, summary: unknown) {
  const { fresh } = await scoped(session);
  if (typeof summary !== 'string' || !summary.trim()) throw new DomainError('Summary required');
  updateSession(fresh.id, { status: 'complete', reason: summary.trim(),
    metadata: { ...fresh.metadata, task_review_active: false, code_review_submitted: true } });
  markAgentWorkFinished(fresh.id);
  return { completed: true, remarks: (fresh.metadata.task_review_items as string[]).length };
}
