import { Router } from 'express';
import { typedRoutes } from '../typed-route';
import { launchTaskAgent } from '../../../core/preparation/launch';
import { DomainError } from '../../../models/domain-error';
export const runsRouter = Router({ mergeParams: true });
const routes = typedRoutes(runsRouter, '/api/projects/:projectId/tasks/:taskId/runs');
// Keep the launch URL for existing clients; execution history belongs to sessions.
routes.json('POST /api/projects/:projectId/tasks/:taskId/runs', async (req, res) => {
  try { res.status(201).json(await launchTaskAgent(req.params.projectId, req.params.taskId, req.body)); }
  catch (error) { if (error instanceof DomainError) return res.status(error.status).json({ error: error.message }); throw error; }
});
