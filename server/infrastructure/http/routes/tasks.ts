import { Router, Request, Response } from 'express';
import { listTasks, getTask, createTask, updateTask, deleteTask } from '../../../core/tasks';
import { getProject, groupMembers } from '../../../core/projects';
import { moveTask } from '../../../core/orchestration/task-move';
import { getOrchestrator } from '../../../core/orchestration/orchestrator';
import { listSessions } from '../../../core/agent-sessions/sessions';
import { closeSession } from '../../../core/agent-sessions/acp-host';
import { deletePlanFile } from '../../../core/orchestration/plan-file';

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.get('/', (req: Request, res: Response) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // A group's list can include its projects' tasks too (each task carries its project_id).
  const withMembers = project.kind === 'group' && req.query.members === '1';
  const tasks = withMembers ? [project, ...groupMembers(project.id)].flatMap(p => listTasks(p.id)) : listTasks(projectId);
  res.json(tasks.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

tasksRouter.post('/:taskId/move', async (req: Request, res: Response) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Not found' });
  try { res.json(await moveTask(task.id, String(req.body.project_id ?? ''))); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

tasksRouter.get('/:taskId', (req: Request, res: Response) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

tasksRouter.post('/', (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { key, title, description, jira_url, branch_name } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  const project = getProject(projectId);
  if (!project || project.kind === 'source') return res.status(404).json({ error: 'Project not found' });
  const t = createTask({ project_id: projectId, key, title, description, jira_url, branch_name });
  res.status(201).json(t);
});

tasksRouter.patch('/:taskId', (req: Request, res: Response) => {
  const t = updateTask(req.params.taskId, req.body);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

tasksRouter.delete('/:taskId', async (req: Request, res: Response) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const project = getProject(task.project_id);

  // Stop the orchestrator if a queue is running for this task.
  await getOrchestrator(task.id)?.stop('Задача удалена');

  // Kill any live agent sessions tied to this task's runs.
  for (const chat of listSessions(task.project_id).filter(s => s.task_id === task.id)) await closeSession(chat.id);

  // Remove the on-disk plan file (DB rows cascade via FK ON DELETE CASCADE).
  if (project) { try { deletePlanFile(task, project.repo_path); } catch { /* ignore */ } }

  deleteTask(task.id);
  res.status(204).end();
});
