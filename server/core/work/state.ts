import type { Task, Workspace, TaskQueue, WorkState } from '../../models';
import type { AgentSession } from '../agents';
import type { FinishStatus } from '../../models/finish';

export interface WorkInput {
  task: Task; workspace?: Workspace | null; queue?: TaskQueue;
  sessions?: Pick<AgentSession, 'role' | 'status'>[];
  plan?: string; remarks?: number;
  mrState?: string;
  finish?: { status: FinishStatus; error?: string } | null;
  /** An errand whose chat is open but the developer has not written the request yet. */
  awaitingBrief?: boolean;
  /** The agent has finished its work at least once: an explicitly completed errand, a plan's queue. */
  workDone?: boolean;
}
/** Presentation policy only; no storage, network or clock access. */
export function computeWorkState(input: WorkInput): WorkState {
  const { task, workspace, queue, finish } = input;
  const allSessions = input.sessions ?? [];
  // Preparation agents never move a task into execution, even while finishing a review turn.
  const preparation = allSessions.filter(s => ['analyst', 'material-author', 'planner', 'plan-reviewer'].includes(s.role));
  const sessions = allSessions.filter(s => !preparation.includes(s));
  const preparationActive = preparation.filter(s => ['starting', 'thinking'].includes(s.status));
  const preparationWaiting = preparation.filter(s => s.status === 'waiting').length;
  const active = sessions.filter(s => s.status === 'thinking' || s.status === 'starting');
  const waiting = sessions.filter(s => s.status === 'waiting').length;
  const steps = (input.plan ?? '').split('\n').filter(line => /^\s*- \[[ x]\]/i.test(line));
  // Follow-up chat turns do not restart completed execution; open plan steps and a new queue still do.
  const followUpStage = input.workDone && queue?.status !== 'running'
    && (task.kind === 'errand' || (steps.length > 0 && steps.every(line => /\[x\]/i.test(line)))) ? 'check' : 'execution';
  const base = {
    hasBranch: workspace?.status === 'ready',
    agentWorking: active.length + preparationActive.length > 0 || queue?.status === 'running',
    // Проверка opens with a filled plan (or finished work) and closes only while a queue runs.
    canCheck: (steps.length > 0 || !!input.workDone) && queue?.status !== 'running',
    counts: { steps: steps.length, completed: steps.filter(line => /\[x\]/i.test(line)).length,
      remarks: input.remarks ?? 0, waiting: waiting + preparationWaiting, agents: active.length + preparationActive.length },
  };
  const result = (stage: WorkState['stage'], status: WorkState['status'], group: WorkState['group'],
    icon: WorkState['icon'], text: string, action: WorkState['action'], actionLabel: string): WorkState =>
    ({ ...base, stage, status, group, icon, text, action, actionLabel });
  if (task.closed_at || task.status === 'done') return { ...result('done', 'closed', 'done', '✔',
    task.close_reason === 'cancelled' ? 'Поручение отменено' : 'Работа закрыта',
    input.mrState === 'merged' ? 'errand' : 'reopen', input.mrState === 'merged' ? 'Поручение по этой' : 'Открыть снова'), agentWorking: false, canCheck: true };
  // The place is not a stage: a task whose queue never ran is still in preparation while its folder is made.
  const placeStage = task.kind === 'task' && (!queue || queue.status === 'idle') ? 'plan' : 'execution';
  if (workspace?.status === 'failed') return result(placeStage, 'failed', 'attention', '❗', workspace.error || 'Рабочее место недоступно', 'recreate', 'Пересоздать');
  if (workspace?.status === 'preparing') return result(placeStage, 'preparing', 'preparation', '◌', 'Подготовка рабочего места', 'chat', 'Открыть');
  if (task.kind === 'errand' && !sessions.length) return result('execution', 'preparing', 'preparation', '◌', 'Запуск поручения', 'chat', 'Открыть');
  if (input.awaitingBrief) return result('execution', 'waiting', 'attention', '❗', 'Напишите агенту, что сделать', 'chat', 'Написать агенту');
  const queueWaiting = queue?.stages.flatMap(s => s.sessions).some(s => ['waiting_for_developer', 'ready_for_execution'].includes(s.status));
  if (waiting || queueWaiting || queue?.status === 'paused') return result(followUpStage, 'waiting', 'attention', '❗', 'Нужно ваше действие', waiting ? 'chat' : 'queue', waiting ? 'Ответить агенту' : 'Продолжить');
  if (finish && !['complete', 'cancelled'].includes(finish.status)) return result('check',
    finish.status === 'running' ? 'finishing' : finish.status === 'error' ? 'failed' : 'waiting',
    finish.status === 'running' ? 'working' : 'attention', '⇪', finish.error || 'Завершение работы', 'check', 'Проверка');
  if (active.some(s => s.role === 'task-reviewer') || queue?.stages.flatMap(s => s.sessions).some(s => s.kind === 'review' && ['running', 'reviewing'].includes(s.status)))
    return result('check', 'reviewing', 'working', '🤖', 'Идёт ревью', 'check', 'Проверка');
  if (active.length || queue?.status === 'running') return result(followUpStage, 'running', 'working', '◌',
    active.some(s => s.role === 'task-chat') ? 'Агент исправляет замечания' : followUpStage === 'check' ? 'Агент отвечает' : 'Агент работает', 'chat', followUpStage === 'check' ? 'Открыть чат' : 'Выполнение');
  if (queue?.status === 'failed' || sessions.some(s => s.status === 'error')) return result(followUpStage, 'failed', 'attention', '❗', queue?.reason || 'Работа прервана', 'chat', 'Открыть');
  if (input.remarks) return result('check', 'fixes', 'attention', '✎', 'Есть замечания ревью', 'check', 'Проверить замечания');
  if (finish?.status === 'complete') return result('check', 'ready', 'attention', '⇪', 'Можно закрыть работу', 'check', 'Закрыть работу');
  // A plan with open steps stays in Выполнение however many queues have run; Проверка is only reachable (canCheck).
  if (task.kind === 'task' && base.counts.steps > base.counts.completed
    && ((queue && queue.status !== 'idle') || sessions.some(s => ['executor', 'task-chat'].includes(s.role))))
    return result('execution', 'waiting', 'attention', '❗', `Выполнено ${base.counts.completed} из ${base.counts.steps} шагов`, 'queue', 'Продолжить');
  const readyForCheck = task.kind === 'errand' ? !!input.workDone
    : queue?.status === 'finished' || sessions.some(s => ['executor', 'task-chat'].includes(s.role) && ['ready', 'complete'].includes(s.status));
  if (readyForCheck)
    return result('check', 'ready', 'attention', '✓', 'Готово к проверке', 'check', 'Проверить');
  if (task.kind === 'errand') return result('execution', 'waiting', 'attention', '❗', 'Ожидает продолжения обсуждения или работы', 'chat', 'Продолжить');
  if (preparationWaiting) return result('plan', 'waiting', 'attention', '❗', 'Нужен ваш ответ при подготовке', 'plan', 'Открыть подготовку');
  if (preparationActive.length) return result('plan', 'running', 'working', '◌', 'Агент готовит задачу', 'plan', 'Открыть подготовку');
  if (preparation.some(s => s.status === 'error')) return result('plan', 'failed', 'attention', '❗', 'Подготовка прервана', 'plan', 'Открыть подготовку');
  if (steps.length) return result('plan', 'draft', 'preparation', '○', 'План готов к выполнению', 'queue', 'Настроить выполнение');
  return result('plan', 'draft', 'preparation', '○', 'Подготовьте план', 'plan', 'Добавить план');
}
