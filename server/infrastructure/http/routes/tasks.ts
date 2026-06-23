import { Router, Request, Response } from 'express';
import { listTasks, getTask, createTask, updateTask, deleteTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { listRuns } from '../../../core/runs';
import { getOrchestrator, removeOrchestrator } from '../../../core/orchestration/orchestrator';
import { getSession, removeSession } from '../../../core/sessions/session-registry';
import { killAgent } from '../../adapters/generic';
import { deletePlanFile } from '../../../core/orchestration/plan-file';

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

tasksRouter.delete('/:taskId', async (req: Request, res: Response) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const project = getProject(task.project_id);

  // Stop the orchestrator if a queue is running for this task.
  const orch = getOrchestrator(task.id);
  if (orch) { orch.fail('Task deleted'); removeOrchestrator(task.id); }

  // Kill any live agent sessions tied to this task's runs.
  for (const run of listRuns(task.id)) {
    const session = getSession(run.id);
    if (session) {
      try { await killAgent(session.sessionId, session.mode); } catch { /* already gone */ }
      removeSession(run.id);
    }
  }

  // Remove the on-disk plan file (DB rows cascade via FK ON DELETE CASCADE).
  if (project) { try { deletePlanFile(task, project.repo_path); } catch { /* ignore */ } }

  deleteTask(task.id);
  res.status(204).end();
});
