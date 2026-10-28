import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';
import { CodeError } from '../code/files';
import { sendPrompt, sessionSignals } from '../agent-sessions/acp-host';
import { getSession } from '../agent-sessions/sessions';
import type { AgentSession } from '../agent-sessions/types';
import { getTask } from '../tasks';
import { getLatestPlan } from '../orchestration/plans';
import { resolveReviewSkill } from '../library/review-skill';
import { detail, finishThreads, openIdleThread, repo, row, state, threads } from './index';
import { mrReviews } from './mr';
import { remarks, sessionReview } from './remarks';
import * as questions from './questions';

/** How the agent reviews together with the developer; returned by get_review_brief, not editable. */
const PROTOCOL = [
  'Ты помогаешь разработчику делать ревью чужого кода. Замечания публикует разработчик от своего имени; ты только готовишь черновики, код и git не трогаешь.',
  'Скилл ревью (skill) — что разработчику важно и что пропускать. Следуй ему; если он велит что-то не проверять, не пиши об этом.',
  'Разбор МР (когда о нём просят): изучи весь diff диапазона (git diff range.from..HEAD в рабочей копии) и код вокруг. ' +
    'Затем один раз вызови set_review_overview: сводка в markdown — что меняется и зачем, как связаны части, на что обратить внимание при ревью (файлы со строками). Коротко, без пересказа каждого файла.',
  'Потом по каждому замечанию вызови add_review_remark. Замечание к месту: path и line из diff (side old для удалённых строк). Замечание к МР целиком (архитектура, подход, разбиение): без path. ' +
    'text — готовый комментарий для МР от имени разработчика: конкретно, вежливо, что не так и что предложить.',
  'Не дублируй обсуждения коллег (threads) и уже существующие замечания (remarks). Лучше меньше замечаний, но по делу. Пиши по-русски, если скилл или описание МР не требуют иного.',
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
      threads = info.threads.map(t => ({ where: t.path ? t.path + ':' + t.line : 'весь МР', resolved: t.resolved, notes: t.notes.map(n => ({ author: n.author, mine: n.mine, body: n.body })) }));
    } catch (e) { mr = { error: e instanceof Error ? e.message : 'Не удалось загрузить МР' }; }
  }
  return {
    protocol: PROTOCOL,
    range: { from: s.from, head: s.headSha, branch: s.head.name, base: s.base.name },
    merge_request: mr,
    developer_context: r.context || null,
    task: task ? { key: task.key, title: task.title ?? '', description: task.description ?? '', plan: getLatestPlan(task.id)?.content ?? '' } : null,
    skill: { title: skill.title, content: skill.content },
    threads,
    remarks: (await remarks().list(r.project_id, r.id)).remarks.map(m => ({ where: m.path ? m.path + ':' + m.line : 'весь МР', author: m.author, status: m.status, text: m.body })),
    overview: r.overview || null,
  };
}
/** set_review_overview: the agent's summary of the merge request, shown on the Обзор tab. */
export async function setOverview(session: AgentSession, text: unknown) {
  const r = sessionReview(session), value = typeof text === 'string' ? text.trim() : '';
  if (!value) throw new CodeError('Overview text is required');
  const s = await state(repo(r.project_id), r);
  getDb().prepare("UPDATE branch_reviews SET overview=?,overview_head=?,updated_at=datetime('now') WHERE id=?").run(value.slice(0, 50000), s.headSha, r.id);
  broadcast({ type: 'branch_review_updated', projectId: r.project_id, reviewId: r.id });
  return { saved: true };
}

/** Starts the agent on the whole review: an overview and draft remarks, following the chosen skill. One review per start: again only after «Новое ревью». */
export async function analyze(projectId: string, id: string, input: { note?: unknown }) {
  if (row(projectId, id).analysis_status) throw new CodeError('Ревью уже проведено: начните новое', 409);
  const thread = await openIdleThread(projectId, id, 'Агент работает: дождитесь конца ответа');
  const wish = typeof input.note === 'string' ? input.note.trim().slice(0, 4000) : '';
  setAnalysis(id, 'running', thread.session_id, wish);
  notify(projectId, id);
  try {
    await sendPrompt(thread.session_id, [{ type: 'text', text: 'Разбери МР: вызови get_review_brief, изучи изменения, запиши сводку через set_review_overview и черновики замечаний через add_review_remark.' + (wish ? '\nПожелание разработчика: ' + wish : '') }]);
  } catch (error) {
    setAnalysis(id, '', '', '');
    notify(projectId, id);
    throw error;
  }
  return { thread };
}
const setAnalysis = (id: string, status: string, session: string, wish: string) =>
  getDb().prepare("UPDATE branch_reviews SET analysis_status=?,analysis_session=?,analysis_note=?,updated_at=datetime('now') WHERE id=?").run(status, session, wish, id);
const notify = (projectId: string, id: string) => broadcast({ type: 'branch_review_updated', projectId, reviewId: id });
/** The review is over when the agent's turn ends; later turns of the same session answer questions. */
function finishAnalysis(sessionId: string, status: 'done' | 'failed') {
  const r = getDb().prepare("SELECT id,project_id FROM branch_reviews WHERE analysis_session=? AND analysis_status='running'").get(sessionId) as { id: string; project_id: string } | undefined;
  if (!r) return;
  getDb().prepare("UPDATE branch_reviews SET analysis_status=?,updated_at=datetime('now') WHERE id=?").run(status, r.id);
  notify(r.project_id, r.id);
}
sessionSignals.on('turn_end', (sessionId: string) => finishAnalysis(sessionId, 'done'));
sessionSignals.on('error-state', (sessionId: string) => finishAnalysis(sessionId, 'failed'));

/**
 * «Новое ревью»: the agents of the review are closed, so the next start gets a fresh one. The overview goes and so do
 * the agent's drafts the developer has not touched; the developer's remarks, edited drafts and the questions stay.
 */
export async function restart(projectId: string, id: string) {
  row(projectId, id);
  const working = threads(projectId, id).some(t => { try { return ['starting', 'thinking'].includes(getSession(t.session_id).status); } catch { return false; } });
  if (working) throw new CodeError('Агент ещё работает: дождитесь конца ответа', 409);
  await finishThreads(projectId, id);
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM branch_review_remarks WHERE review_id=? AND author='agent' AND status='draft' AND edited=0 AND remote_id IS NULL").run(id);
    getDb().prepare("UPDATE branch_reviews SET overview='',overview_head='',analysis_status='',analysis_session='',analysis_note='',updated_at=datetime('now') WHERE id=?").run(id);
  })();
  notify(projectId, id);
  return detail(projectId, id);
}
/** The next round: one general question asking the agent whether the published remarks were addressed. */
export async function checkFixes(projectId: string, id: string) {
  const r = row(projectId, id);
  if (!r.published_head) throw new CodeError('Вы ещё не публиковали замечаний', 409);
  const text = 'Проверь, исправлены ли мои опубликованные замечания (мои треды в threads и отправленные remarks) в коммитах после ' + r.published_head.slice(0, 12) +
    ': по каждому — исправлено / частично / нет, коротко почему. Отдельно отметь новые проблемы в этих коммитах, если они есть.';
  const added = await questions.add(projectId, id, { text });
  const question = added.questions.at(-1)!;
  return questions.send(projectId, id, { question_ids: [question.id] });
}
