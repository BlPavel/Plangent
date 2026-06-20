import { Router, Request, Response } from 'express';
import { listTasks, getTask, createTask, updateTask, deleteTask } from '../../storage/tasks';
import { getProject } from '../../storage/projects';

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.get('/', (req: Request, res: Response) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) return res.status(404).json({ error: 'Project not found' });
  res.json(listTasks(projectId));
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
  if (!getProject(projectId)) return res.status(404).json({ error: 'Project not found' });
  const t = createTask({ project_id: projectId, key, title, description, jira_url, branch_name });
  res.status(201).json(t);
});

tasksRouter.patch('/:taskId', (req: Request, res: Response) => {
  const t = updateTask(req.params.taskId, req.body);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

tasksRouter.delete('/:taskId', (req: Request, res: Response) => {
  const ok = deleteTask(req.params.taskId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});
