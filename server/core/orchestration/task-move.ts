import fs from 'fs';
import { getDb } from '../../infrastructure/db/schema';
import { getProject } from '../projects';
import { getTask } from '../tasks';
import { listSessions } from '../agent-sessions/sessions';
import { closeSession } from '../agent-sessions/acp-host';
import { getQueue, isFrozen, saveQueue } from './queue';
import { stopWatchPlanFile } from './plan-file';
import { getTaskDirectory, stopWatchAnalysis } from './task-files';
import { initTaskFile } from './task-files-startup';
import type { Task } from '../../models';

/**
 * Moves a task between a group and a project (either way). Its .plangent folder follows it; its chats stay
 * with it and continue in the new folder.
 */
export async function moveTask(taskId: string, targetId: string): Promise<Task> {
  const task = getTask(taskId);
  if (!task) throw new Error('Задача не найдена');
  const from = getProject(task.project_id), to = getProject(targetId);
  if (!from || !to || to.kind === 'source') throw new Error('Проект не найден');
  if (from.id === to.id) return task;
  const related = from.kind === 'group' ? to.group_id === from.id : to.kind === 'group' && from.group_id === to.id;
  if (!related) throw new Error('Задачу можно перенести только между группой и её проектом');
  if (isFrozen(getQueue(task.id, from.id))) throw new Error('Сначала остановите выполнение задачи');
  if (getDb().prepare('SELECT 1 FROM tasks WHERE project_id=? AND key=?').get(to.id, task.key)) {
    throw new Error(`В «${to.name}» уже есть задача ${task.key}`);
  }

  const chats = listSessions(from.id).filter(s => s.task_id === task.id);
  for (const chat of chats) await closeSession(chat.id);
  stopWatchPlanFile(task.id);
  stopWatchAnalysis(task.id);

  const source = getTaskDirectory(from.repo_path, task.key), target = getTaskDirectory(to.repo_path, task.key);
  if (fs.existsSync(source)) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }

  getDb().transaction(() => {
    getDb().prepare('UPDATE tasks SET project_id=? WHERE id=?').run(to.id, task.id);
    getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE task_id=?').run(to.id, task.id);
  })();
  const queue = getQueue(task.id, from.id);
  if (queue.projectId !== to.id && getDb().prepare('SELECT 1 FROM task_queues WHERE task_id=?').get(task.id)) saveQueue({ ...queue, projectId: to.id });

  const moved = getTask(task.id)!;
  initTaskFile(moved);
  return moved;
}
