import { transaction } from '../../../infrastructure/db/repositories/review/transaction';
import { sendReviewBatch, reviewBrief, reviewTransition } from '../kernel';
import * as queries from '../../../infrastructure/db/repositories/review/branch/brief';
import { broadcast } from '../../shared';
import { DomainError } from '../../../models/domain-error';
import { onAgentEvent} from '../../agents';
import { getSession } from '../../agents';
import type { AgentSession } from '../../agents';
import { getTask } from '../../tasks';
import { getLatestPlan } from '../../preparation';
import { resolveMrReviewInstruction, resolveReviewSkill } from '../../library';
import { detail, finishThreads, openIdleThread, repo, row, state, threads } from './index';
import { mrReviews } from './mr';
import { remarks, sessionReview } from './remarks';
import * as questions from './questions';

/** How the agent reviews together with the developer; returned by get_review_brief, not editable. */
const PROTOCOL = [
  'You help the developer review someone else’s code. The developer publishes remarks under their own name; prepare drafts only and do not change code or git.',
  'Follow the review instruction: it describes what matters and what to skip. If a review skill is given, it adds the requirements of this project; apply both and do not report things they exclude.',
  'When asked to review the MR, inspect the entire diff (git diff range.from..HEAD in the worktree) and surrounding code. Then call set_review_overview once with a concise Markdown summary: what changes and why, how the parts fit together, and where to focus the review (files and lines). Do not summarize every file.',
  'Call add_review_remark for each finding. For a line remark, provide path and line from the diff (side old for deleted lines). Omit path for an MR-wide remark. Write text as a concrete, polite MR comment from the developer, explaining the problem and suggested change.',
  'The developer may discuss a remark with you; when the discussion changes it, rewrite it with revise_review_remark. Remarks with status rejected were rejected by the developer: do not suggest them again without new evidence. Do not duplicate existing threads or remarks. Prefer fewer substantive findings. Write in Russian unless the instruction, the skill or MR description requires another language.',
];

/** get_review_brief: everything the agent needs to know about the review besides the code. */
export async function brief(session: AgentSession) {
  const r = sessionReview(session), project = repo(r.project_id), s = await state(project, r);
  const task = r.task_id ? getTask(r.task_id) : null;
  const skill = resolveReviewSkill(r.project_id, r.skill_id);
  let mr: unknown = null, threads: unknown = [];
  if (r.mr_iid) {
    try {
      const info = await mrReviews().info(r.project_id, r.id);
      mr = info.mr;
      threads = info.threads.map(t => ({ id: t.id, where: t.path ? t.path + ':' + t.line : 'весь МР', resolved: t.resolved, notes: t.notes.map(n => ({ author: n.author, mine: n.mine, body: n.body })) }));
    } catch (e) { mr = { error: e instanceof Error ? e.message : 'Не удалось загрузить МР' }; }
  }
  return reviewBrief(PROTOCOL, skill ? { title: skill.title, content: skill.content } : null, {
    instruction: resolveMrReviewInstruction(),
    range: { from: s.from, head: s.headSha, branch: s.head.name, base: s.base.name },
    merge_request: mr,
    developer_context: r.context || null,
    task: task ? { key: task.key, title: task.title ?? '', description: task.description ?? '', plan: getLatestPlan(task.id)?.content ?? '' } : null,
    threads,
    remarks: (await remarks().list(r.project_id, r.id)).remarks.map(m => ({ id: m.id, where: m.path ? m.path + ':' + m.line : 'весь МР', author: m.author, status: m.status, text: m.body })),
    overview: r.overview || null,
  });
}
/** set_review_overview: the agent's summary of the merge request, shown on the Обзор tab. */
export async function setOverview(session: AgentSession, text: unknown) {
  const r = sessionReview(session), value = typeof text === 'string' ? text.trim() : '';
  if (!value) throw new DomainError('Overview text is required');
  const s = await state(repo(r.project_id), r);
  queries.setOverviewUpdateBranchReviews(value.slice(0, 50000), s.headSha, r.id);
  broadcast({ type: 'branch_review_updated', projectId: r.project_id, reviewId: r.id });
  return { saved: true };
}

/** Starts the agent on the whole review: an overview and draft remarks, following the chosen skill. One review per start: again only after «Новое ревью». */
export async function analyze(projectId: string, id: string, input: { note?: unknown; agent_id?: unknown; model?: unknown; reasoning_effort?: unknown }) {
  const status = reviewTransition(row(projectId, id).analysis_status, 'start',
    { idle: '', running: 'running', reported: 'done' }, 'Ревью уже проведено: начните новое');
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : undefined);
  const thread = await openIdleThread(projectId, id, 'Агент работает: дождитесь конца ответа', { agentId: text(input.agent_id), model: text(input.model), effort: text(input.reasoning_effort) });
  const wish = typeof input.note === 'string' ? input.note.trim().slice(0, 4000) : '';
  setAnalysis(id, status, thread.session_id, wish);
  notify(projectId, id);
  try {
    await sendReviewBatch(thread.session_id, 'Review the MR: call get_review_brief, inspect the changes, save an overview with set_review_overview, and draft findings with add_review_remark.' + (wish ? '\nDeveloper request: ' + wish : ''));
  } catch (error) {
    setAnalysis(id, '', '', '');
    notify(projectId, id);
    throw error;
  }
  return { thread };
}
const setAnalysis = (id: string, status: string, session: string, wish: string) =>
  queries.setAnalysisUpdateBranchReviews(status, session, wish, id);
const notify = (projectId: string, id: string) => broadcast({ type: 'branch_review_updated', projectId, reviewId: id });
/** The review is over when the agent's turn ends; later turns of the same session answer questions. */
function finishAnalysis(sessionId: string, status: 'done' | 'failed') {
  const r = queries.rSelectBranchReviews(sessionId) as { id: string; project_id: string } | undefined;
  if (!r) return;
  queries.finishAnalysisUpdateBranchReviews(status, r.id);
  notify(r.project_id, r.id);
}
onAgentEvent('turn_end', (sessionId: string) => finishAnalysis(sessionId, 'done'));
onAgentEvent('error-state', (sessionId: string) => finishAnalysis(sessionId, 'failed'));

/**
 * «Новое ревью»: the agents of the review are closed, so the next start gets a fresh one. The overview goes and so do
 * the agent's drafts the developer has not touched; the developer's remarks, edited drafts and the questions stay.
 */
export async function restart(projectId: string, id: string) {
  row(projectId, id);
  const working = threads(projectId, id).some(t => { try { return ['starting', 'thinking'].includes(getSession(t.session_id).status); } catch { return false; } });
  if (working) throw new DomainError('Агент ещё работает: дождитесь конца ответа', 409);
  await finishThreads(projectId, id);
  transaction(() => {
    queries.restartDeleteBranchReviewRemarks(id);
    queries.restartUpdateBranchReviews(id);
  });
  notify(projectId, id);
  return detail(projectId, id);
}
/** The next round: one general question asking the agent whether the published remarks were addressed. */
export async function checkFixes(projectId: string, id: string) {
  const r = row(projectId, id);
  if (!r.published_head) throw new DomainError('Вы ещё не публиковали замечаний', 409);
  const text = 'Проверь, исправлены ли мои опубликованные замечания (мои треды в threads и отправленные remarks) в коммитах после ' + r.published_head.slice(0, 12) +
    ': по каждому — исправлено / частично / нет, коротко почему. Отдельно отметь новые проблемы в этих коммитах, если они есть.';
  const added = await questions.add(projectId, id, { text });
  const question = added.questions.at(-1)!;
  return questions.send(projectId, id, { question_ids: [question.id] });
}
