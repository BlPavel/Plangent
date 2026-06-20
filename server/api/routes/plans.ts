import { Router, Request, Response } from 'express';
import { getLatestPlan, listPlans, createPlan, updatePlan, parsePlanSteps, markStepDone } from '../../storage/plans';
import { getTask } from '../../storage/tasks';

export const plansRouter = Router({ mergeParams: true });

plansRouter.get('/', (req: Request, res: Response) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(listPlans(t.id));
});

plansRouter.get('/latest', (req: Request, res: Response) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const plan = getLatestPlan(t.id);
  if (!plan) return res.status(404).json({ error: 'No plan yet' });
  res.json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouter.post('/', (req: Request, res: Response) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const plan = createPlan({ task_id: t.id, content });
  res.status(201).json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouter.patch('/:planId', (req: Request, res: Response) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const plan = updatePlan(req.params.planId, content);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  res.json({ ...plan, steps: parsePlanSteps(plan.content) });
});

plansRouter.post('/:planId/step/:stepIndex/done', (req: Request, res: Response) => {
  const { planId, stepIndex } = req.params;
  const idx = parseInt(stepIndex, 10);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid step index' });

  const { getPlan } = require('../../storage/plans');
  const plan = getPlan(planId);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const newContent = markStepDone(plan.content, idx);
  const updated = updatePlan(planId, newContent);
  res.json({ ...updated!, steps: parsePlanSteps(updated!.content) });
});
