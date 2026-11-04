import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { Router, type Request, type Response } from 'express';
import { taskMrs, createTaskMrService } from '../../../core/task-mr';
import { CodeError } from '../../../core/code/files';
import { IntegrationError } from '../../../core/integrations';
import { localOrigin } from '../local-origin';
export function createTaskMrRouter(service: () => ReturnType<typeof createTaskMrService> = taskMrs) {
  const router=Router({mergeParams:true});
const routerRoutes = typedRoutes(router, '/api/projects/:projectId/task-mr');
  router.use(localOrigin);
  router.use((req,res,next)=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Invalid body'});next();});
  
  routerRoutes.json('POST /api/projects/:projectId/task-mr/preview', async (req,res)=> { try { return res.json(await service().preview(req.params.projectId,req.body.task_id,req.body.target_branch ?? '')); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/task-mr/describe', async (req,res)=> { try { return res.json(await service().describe(req.params.projectId,req.body)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/task-mr/create', async (req,res)=> { try { return res.json(await service().create(req.params.projectId,req.body,req.body.confirmed)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/task-mr/refresh', async (req,res)=> { try { return res.json(await service().refresh(req.params.projectId,req.body.task_id ?? '')); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/task-mr/close-task', async (req,res)=> { try { return res.json(await service().closeTask(req.params.projectId,req.body.task_id,req.body.confirmed,req.body.delete_branch)); } catch (routeError) { return handleRouteError(routeError, res); } });
  return router;
}
export const taskMrRouter=createTaskMrRouter();

function handleRouteError(error: unknown, res: ErrorResponse) { return res.status(error instanceof CodeError || error instanceof IntegrationError?error.status:500).json({error:error instanceof CodeError || error instanceof IntegrationError?(error as Error).message:'Не удалось выполнить операцию с МР'}); }
