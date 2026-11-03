import { Router, json, Request, Response, NextFunction } from 'express';
import { getTask } from '../../../core/tasks';
import { getLatestMaterial, isMaterialType, saveMaterial } from '../../../core/materials';
import { getPreparationStages, markPreparationStage, preparationStages, PreparationStage } from '../../../core/materials/stages';

export const materialsRouter = Router({ mergeParams: true });
export const preparationRouter = Router({ mergeParams: true });
for (const router of [materialsRouter, preparationRouter]) {
  router.use(json());
  router.use((req: Request, res: Response, next: NextFunction) => {
    const task = getTask(req.params.taskId);
    if (!task || task.project_id !== req.params.projectId) { res.status(404).json({ error: 'Task not found' }); return; }
    next();
  });
}
materialsRouter.get('/:type', (req: Request, res: Response) => {
  if (!isMaterialType(req.params.type)) { res.status(400).json({ error: 'Invalid material type' }); return; }
  res.json(getLatestMaterial(req.params.taskId, req.params.type));
});
materialsRouter.put('/:type', (req: Request, res: Response) => {
  if (!isMaterialType(req.params.type) || !req.body || typeof req.body.content !== 'string') {
    res.status(400).json({ error: 'Material type and content required' }); return;
  }
  res.json(saveMaterial({ task_id: req.params.taskId, type: req.params.type, content: req.body.content,
    expected_version: req.body.expected_version, author: 'developer' }));
});
preparationRouter.get('/', (req: Request, res: Response) => { res.json(getPreparationStages(req.params.taskId)); });
preparationRouter.post('/:stage', (req: Request, res: Response) => {
  if (!preparationStages.includes(req.params.stage as PreparationStage) || !req.body || !['ready', 'skipped'].includes(req.body.status)) {
    res.status(400).json({ error: 'Invalid stage action' }); return;
  }
  res.json(markPreparationStage(req.params.taskId, req.params.stage as PreparationStage, req.body.status));
});
for (const router of [materialsRouter, preparationRouter]) router.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 400).json({ error: error.message });
});

