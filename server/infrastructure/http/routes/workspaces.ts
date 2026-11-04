import { typedRoutes } from '../typed-route';
import { Router, type Request } from 'express';
import { listWorkspaces, getWorkspace, recreateWorkspace, WorkspaceRemovalError } from '../../../core/workspaces';
import { viewing, setViewing } from '../../../core/workspaces/viewing';
import { workEntry } from '../../../core/work';
import { viewingTerminalWarnings } from './terminals';
import { CodeError } from '../../../core/code/files';
export function createWorkspacesRouter(terminalWarnings = viewingTerminalWarnings) {
const workspacesRouter = Router({ mergeParams: true });
const workspacesRouterRoutes = typedRoutes(workspacesRouter, '/api/projects/:projectId/workspaces');
workspacesRouterRoutes.json('GET /api/projects/:projectId/workspaces', (req, res) => res.json(listWorkspaces(req.params.projectId)));
workspacesRouterRoutes.json('GET /api/projects/:projectId/workspaces/viewing', (req, res) => {
  try { res.json(viewing(req.params.projectId)); }
  catch (error) { res.status(error instanceof CodeError ? error.status : 400).json({ error: String(error) }); }
});
workspacesRouterRoutes.json('PUT /api/projects/:projectId/workspaces/viewing', async (req, res) => {
  try {
    const id = req.body?.workspaceId;
    if (id !== null && typeof id !== 'string') throw new CodeError('workspaceId is required');
    const candidate = id ? getWorkspace(id) : null;
    if (candidate && (candidate.project_id !== req.params.projectId || candidate.status !== 'ready')) throw new CodeError('Workspace not found', 404);
    const state = candidate ? workEntry(candidate.task_id).state : null;
    const terminals = await terminalWarnings(req.params.projectId, id);
    const warnings = { agentWorking: state?.agentWorking ?? false, terminals };
    if ((warnings.agentWorking || terminals.length) && req.body?.confirmed !== true) return res.status(409).json({ error: 'Подтвердите просмотр ветки', warnings });
    res.json({ workspace: setViewing(req.params.projectId, id), warnings });
  } catch (error) { res.status(error instanceof CodeError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
workspacesRouterRoutes.json('POST /api/projects/:projectId/workspaces/:id/recreate', async (req, res) => {
  try {
    const workspace = getWorkspace(req.params.id);
    if (workspace.project_id !== req.params.projectId) throw new CodeError('Workspace not found', 404);
    const state = workEntry(workspace.task_id).state;
    if (state.agentWorking) throw new CodeError('Сначала остановите агента', 409);
    res.json(await recreateWorkspace(workspace.id, { discard: req.body?.discard === true }));
  } catch (error) { res.status(error instanceof CodeError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error),
    ...(error instanceof WorkspaceRemovalError ? { blockers: error.blockers } : {}) }); }
});
return workspacesRouter;
}
export const workspacesRouter = createWorkspacesRouter();
