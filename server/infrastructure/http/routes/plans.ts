import { typedRoutes } from '../typed-route';
import { Router, Request, Response } from 'express';
import { getLatestPlan, listPlans, createPlan, updatePlan, parsePlanSteps, markStepDone, setStepDone, getPlan } from '../../../core/orchestration/plans';
import { getTask } from '../../../core/tasks';

export const plansRouter = Router({ mergeParams: true });
const plansRouterRoutes = typedRoutes(plansRouter, '/api/projects/:projectId/tasks/:taskId/plans');
plansRouter.use((req, res, next) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  if (!['GET', 'HEAD'].includes(req.method) && task.status === 'done')
    return res.status(409).json({ error: 'Завершённая задача доступна только для чтения' });
  next();
});

plansRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/plans', (req, res) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(listPlans(t.id));
});

plansRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/plans/latest', (req, res) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const plan = getLatestPlan(t.id);
  if (!plan) return res.status(404).json({ error: 'No plan yet' });
  res.json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plans', (req, res) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const plan = createPlan({ task_id: t.id, content });
  res.status(201).json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouterRoutes.json('PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const plan = updatePlan(req.params.planId, content);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  res.json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex/done', (req, res) => {
  const { planId, stepIndex } = req.params;
  const idx = parseInt(stepIndex, 10);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid step index' });

  const plan = getPlan(planId);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const newContent = markStepDone(plan.content, idx);
  const updated = updatePlan(planId, newContent);
  res.json({ ...updated!, steps: parsePlanSteps(updated!.content) });
});

plansRouterRoutes.json('PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex', (req, res) => {
  const { planId, stepIndex } = req.params;
  const idx = parseInt(stepIndex, 10);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid step index' });
  if (typeof req.body.done !== 'boolean') return res.status(400).json({ error: 'done boolean required' });

  const plan = getPlan(planId);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const newContent = setStepDone(plan.content, idx, req.body.done);
  const updated = updatePlan(planId, newContent);
  res.json({ ...updated!, steps: parsePlanSteps(updated!.content) });
});
