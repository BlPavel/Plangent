import { typedRoutes } from '../typed-route';
﻿import { Router, json, Request, Response, NextFunction } from 'express';
import { getTask } from '../../../core/tasks';
import { getLatestMaterial, isMaterialType, saveMaterial } from '../../../core/materials';
import { getPreparationStages, markPreparationStage, preparationStages, PreparationStage } from '../../../core/materials/stages';

export const materialsRouter = Router({ mergeParams: true });
const materialsRouterRoutes = typedRoutes(materialsRouter, '/api/projects/:projectId/tasks/:taskId/materials');
export const preparationRouter = Router({ mergeParams: true });
const preparationRouterRoutes = typedRoutes(preparationRouter, '/api/projects/:projectId/tasks/:taskId/preparation');
for (const router of [materialsRouter, preparationRouter]) {
  router.use(json());
  router.use((req: Request, res: Response, next: NextFunction) => {
    const task = getTask(req.params.taskId);
    if (!task || task.project_id !== req.params.projectId) { res.status(404).json({ error: 'Task not found' }); return; }
    next();
  });
}
materialsRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/materials/:type', (req, res) => {
  if (!isMaterialType(req.params.type)) { res.status(400).json({ error: 'Invalid material type' }); return; }
  res.json(getLatestMaterial(req.params.taskId, req.params.type));
});
materialsRouterRoutes.json('PUT /api/projects/:projectId/tasks/:taskId/materials/:type', (req, res) => {
  if (!isMaterialType(req.params.type) || !req.body || typeof req.body.content !== 'string') {
    res.status(400).json({ error: 'Material type and content required' }); return;
  }
  res.json(saveMaterial({ task_id: req.params.taskId, type: req.params.type, content: req.body.content,
    expected_version: req.body.expected_version, author: 'developer' }));
});
preparationRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/preparation', (req, res) => { res.json(getPreparationStages(req.params.taskId)); });
preparationRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/preparation/:stage', (req, res) => {
  if (!preparationStages.includes(req.params.stage as PreparationStage) || !req.body || !['ready', 'skipped'].includes(req.body.status ?? '')) {
    res.status(400).json({ error: 'Invalid stage action' }); return;
  }
  res.json(markPreparationStage(req.params.taskId, req.params.stage as PreparationStage, req.body.status!));
});
for (const router of [materialsRouter, preparationRouter]) router.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 400).json({ error: error.message });
});

