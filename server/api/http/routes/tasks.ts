import { typedRoutes } from '../typed-route';
import { createTaskBranch } from '../../../core/git/repo/task-branch';
import { captureTaskBaseCommit } from '../../../core/git/repo/base-commit';
import { getQueue, isFrozen } from '../../../core/execution/queue';
import { Router, Request, Response } from 'express';
import { listTasks, getTask, createTask, updateTask, deleteTask } from '../../../core/tasks';
import { getProject, groupMembers } from '../../../core/projects';
import { moveTask } from '../../../core/tasks/task-move';
import { getOrchestrator } from '../../../core/execution/orchestrator';
import { listSessions } from '../../../core/agents';
import { closeSession } from '../../../core/agents';

export const tasksRouter = Router({ mergeParams: true });
const tasksRouterRoutes = typedRoutes(tasksRouter, '/api/projects/:projectId/tasks');

tasksRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/base-commit', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Not found' });
  if (task.status === 'done' || isFrozen(getQueue(task.id, task.project_id)))
    return res.status(409).json({ error: 'Точку отсчёта можно менять, пока очередь не запущена' });
  try { res.json(await captureTaskBaseCommit(task.id, true)); }
  catch (cause) { res.status(400).json({ error: cause instanceof Error ? cause.message : String(cause) }); }
});

tasksRouterRoutes.json('GET /api/projects/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // A group's list can include its projects' tasks too (each task carries its project_id).
  const withMembers = project.kind === 'group' && req.query.members === '1';
  const tasks = withMembers ? [project, ...groupMembers(project.id)].flatMap(p => listTasks(p.id)) : listTasks(projectId);
  res.json(tasks.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

tasksRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/move', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Not found' });
  try { res.json(await moveTask(task.id, String(req.body.project_id ?? ''))); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

tasksRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/branch', async (req,res) => {
  try { res.json(await createTaskBranch(req.params.projectId,req.params.taskId,req.body)); }
  catch(e) { res.status((e as { status?: number }).status ?? 400).json({ error: e instanceof Error ? e.message : String(e) }); }
});
tasksRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId', (req, res) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

tasksRouterRoutes.json('POST /api/projects/:projectId/tasks', (req, res) => {
  const { projectId } = req.params;
  const { key, title, description, jira_url, branch_name, kind, auto_review, closed_at, close_reason, origin_task_id, external_key } = req.body;
  const project = getProject(projectId);
  if (!project || project.kind === 'source') return res.status(404).json({ error: 'Project not found' });
  try {
    const t = createTask({ project_id: projectId, key, title, description, jira_url, branch_name, kind, auto_review, closed_at, close_reason, origin_task_id, external_key });
    res.status(201).json(t);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

tasksRouterRoutes.json('PATCH /api/projects/:projectId/tasks/:taskId', (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Not found' });
  let t;
  try { const { title, jira_url, branch_name, status, finish_scenario, target_branch, external_key, base_branch, kind, auto_review, closed_at, close_reason, origin_task_id } = req.body; t = updateTask(req.params.taskId, { title, jira_url, branch_name, status, finish_scenario, target_branch, external_key, base_branch, kind, auto_review, closed_at, close_reason, origin_task_id }); }
  catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

tasksRouterRoutes.empty('DELETE /api/projects/:projectId/tasks/:taskId', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Not found' });

  // Stop the orchestrator if a queue is running for this task.
  await getOrchestrator(task.id)?.stop('Задача удалена');

  // Close live agent sessions belonging to the task.
  for (const chat of listSessions(task.project_id).filter(s => s.task_id === task.id)) await closeSession(chat.id);

  try { await deleteTask(task.id, { discard: req.query.discard === '1' }); }
  catch (error) { return res.status((error as { status?: number }).status ?? 400).json({ error: error instanceof Error ? error.message : String(error), blockers: (error as { blockers?: import('@contracts').ApiError['blockers'] }).blockers }); }

  res.status(204).end();
});
