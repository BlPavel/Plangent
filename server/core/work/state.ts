import type { Task, Workspace, TaskQueue, WorkState } from '../../models';
import type { AgentSession } from '../agent-sessions/types';
import type { FinishStatus } from '../../models/finish';

export interface WorkInput {
  task: Task; workspace?: Workspace | null; queue?: TaskQueue;
  sessions?: Pick<AgentSession, 'role' | 'status'>[];
  plan?: string; remarks?: number;
  mrState?: string;
  finish?: { status: FinishStatus; error?: string } | null;
}
/** Presentation policy only; no storage, network or clock access. */
export function computeWorkState(input: WorkInput): WorkState {
  const { task, workspace, queue, finish } = input;
  const sessions = input.sessions ?? [];
  const active = sessions.filter(s => s.status === 'thinking' || s.status === 'starting');
  const waiting = sessions.filter(s => s.status === 'waiting').length;
  const steps = (input.plan ?? '').split('\n').filter(line => /^\s*- \[[ x]\]/i.test(line));
  const base = {
    hasBranch: workspace?.status === 'ready',
    agentWorking: active.length > 0 || queue?.status === 'running',
    counts: { steps: steps.length, completed: steps.filter(line => /\[x\]/i.test(line)).length,
      remarks: input.remarks ?? 0, waiting, agents: active.length },
  };
  const result = (stage: WorkState['stage'], status: WorkState['status'], group: WorkState['group'],
    icon: WorkState['icon'], text: string, action: WorkState['action'], actionLabel: string): WorkState =>
    ({ ...base, stage, status, group, icon, text, action, actionLabel });
  if (task.closed_at || task.status === 'done') return { ...result('done', 'closed', 'done', '✔',
    task.close_reason === 'cancelled' ? 'Поручение отменено' : 'Работа закрыта',
    input.mrState === 'merged' ? 'errand' : 'reopen', input.mrState === 'merged' ? 'Поручение по этой' : 'Открыть снова'), agentWorking: false };
  if (workspace?.status === 'failed') return result('execution', 'failed', 'attention', '❗', workspace.error || 'Рабочее место недоступно', 'recreate', 'Пересоздать');
  if (workspace?.status === 'preparing') return result('execution', 'preparing', 'preparation', '◌', 'Подготовка рабочего места', 'chat', 'Открыть');
  if (task.kind === 'errand' && !sessions.length) return result('execution', 'preparing', 'preparation', '◌', 'Запуск поручения', 'chat', 'Открыть');
  const queueWaiting = queue?.stages.flatMap(s => s.sessions).some(s => ['waiting_for_developer', 'ready_for_execution'].includes(s.status));
  if (waiting || queueWaiting || queue?.status === 'paused') return result('execution', 'waiting', 'attention', '❗', 'Нужно ваше действие', waiting ? 'chat' : 'queue', waiting ? 'Ответить агенту' : 'Продолжить');
  if (finish && !['complete', 'cancelled'].includes(finish.status)) return result('finish',
    finish.status === 'running' ? 'finishing' : finish.status === 'error' ? 'failed' : 'waiting',
    finish.status === 'running' ? 'working' : 'attention', '⇪', finish.error || 'Завершение работы', 'finish', 'Завершение');
  if (active.some(s => s.role === 'task-reviewer') || queue?.stages.flatMap(s => s.sessions).some(s => s.kind === 'review' && ['running', 'reviewing'].includes(s.status)))
    return result('check', 'reviewing', 'working', '🤖', 'Идёт ревью', 'check', 'Проверка');
  if (active.length || queue?.status === 'running') return result('execution', 'running', 'working', '◌',
    active.some(s => s.role === 'task-chat') ? 'Агент исправляет замечания' : 'Агент работает', 'chat', 'Открыть чат');
  if (queue?.status === 'failed' || sessions.some(s => s.status === 'error')) return result('execution', 'failed', 'attention', '❗', queue?.reason || 'Работа прервана', 'chat', 'Открыть');
  if (input.remarks) return result('check', 'fixes', 'attention', '✎', 'Есть замечания ревью', 'check', 'Проверить замечания');
  if (finish?.status === 'complete') return result('finish', 'ready', 'attention', '⇪', 'Можно закрыть работу', 'finish', 'Завершение');
  if (task.kind === 'errand' || queue?.status === 'finished' || sessions.some(s => ['executor', 'task-chat', 'errand'].includes(s.role) && ['ready', 'complete'].includes(s.status)))
    return result('check', 'ready', 'attention', '✓', 'Готово к проверке', 'check', 'Проверить');
  if (steps.length) return result('execution', 'draft', 'preparation', '○', 'План готов к выполнению', 'queue', 'Настроить выполнение');
  return result('plan', 'draft', 'preparation', '○', 'Подготовьте план', 'plan', 'Добавить план');
}
