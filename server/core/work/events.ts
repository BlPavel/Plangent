import * as records from '../../infrastructure/db/repositories/work/events';
import { onBroadcast, broadcast } from '../shared';
import { getTask } from '../tasks';
import { getSession, history, updateSession } from '../agents';
import { onAgentEvent} from '../agents';
let initialized = false;
export function initWorkEvents() {
  if (initialized) return;
  initialized = true;
  onBroadcast(event => {
    if (!['queue_updated', 'agent_session', 'agent_session_deleted', 'code_review_updated', 'finish:changed', 'workspace:update', 'task_updated', 'plan_updated'].includes(event.type)) return;
    const session = event.session as { task_id?: string; project_id?: string } | undefined;
    const run = event.run as { task_id?: string; project_id?: string } | undefined;
    const workspace = event.workspace as { task_id?: string; project_id?: string } | undefined;
    const queue = event.queue as { taskId?: string; projectId?: string; status?: string } | undefined;
    const taskId = event.taskId as string | undefined ?? session?.task_id ?? run?.task_id ?? workspace?.task_id ?? queue?.taskId;
    const task = taskId ? getTask(taskId) : null;
    const projectId = event.projectId ?? task?.project_id ?? session?.project_id ?? run?.project_id;
    if (projectId) broadcast({ type: 'work:update', projectId, taskId });
    if (queue?.status === 'finished' && task) {
      const previous = records.initWorkEventsAppSettings('work:queue:' + task.id) as { value: string } | undefined;
      if (previous?.value !== 'finished') broadcast({ type: 'work:ready_for_check', projectId: task.project_id, taskId: task.id, taskKey: task.key });
    }
    if (queue && task) records.initWorkEventsAppSettings2('work:queue:' + task.id, queue.status);
  });
  onAgentEvent('turn_end', (id: string) => {
    const session = getSession(id), task = session.task_id ? getTask(session.task_id) : null;
    if (!task || task.closed_at || task.status === 'done' || !['errand', 'task-chat'].includes(session.role) || !['ready', 'complete'].includes(session.status)) return;
    const end = history(id).filter(e => e.type === 'turn_end').at(-1);
    if (!end || end.payload.stopReason === 'cancelled' || session.metadata.work_notified_turn === end.seq) return;
    const fixes = session.metadata.work_fix_pending === true;
    // An ordinary errand reply is a discussion, not a completed piece of work.
    if (session.role === 'errand' && !fixes && session.status !== 'complete') return;
    updateSession(id, { metadata: { ...session.metadata, work_notified_turn: end.seq, work_fix_pending: false } });
    if (session.role === 'task-chat' && !fixes) return;
    broadcast({ type: fixes ? 'work:fixes_ready' : 'work:ready_for_check', projectId: task.project_id, taskId: task.id, taskKey: task.key });
  });
}
