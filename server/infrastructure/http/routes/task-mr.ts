import { Router, type Request, type Response } from 'express';
import { taskMrs, createTaskMrService } from '../../../core/task-mr';
import { CodeError } from '../../../core/code/files';
import { IntegrationError } from '../../../core/integrations';
import { localOrigin } from '../local-origin';
export function createTaskMrRouter(service: () => ReturnType<typeof createTaskMrService> = taskMrs) {
  const router=Router({mergeParams:true});
  router.use(localOrigin);
  router.use((req,res,next)=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Invalid body'});next();});
  const guard=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response)=>{
    Promise.resolve().then(()=>fn(req,res)).catch(error=>res.status(error instanceof CodeError || error instanceof IntegrationError?error.status:500).json({error:error instanceof CodeError || error instanceof IntegrationError?error.message:'Не удалось выполнить операцию с МР'}));
  };
  router.post('/preview',guard(async(req,res)=>res.json(await service().preview(req.params.projectId,req.body.task_id,req.body.target_branch))));
  router.post('/describe',guard(async(req,res)=>res.json(await service().describe(req.params.projectId,req.body))));
  router.post('/create',guard(async(req,res)=>res.json(await service().create(req.params.projectId,req.body,req.body.confirmed))));
  router.post('/refresh',guard(async(req,res)=>res.json(await service().refresh(req.params.projectId,req.body.task_id))));
  router.post('/close-task',guard(async(req,res)=>res.json(await service().closeTask(req.params.projectId,req.body.task_id,req.body.confirmed,req.body.delete_branch))));
  return router;
}
export const taskMrRouter=createTaskMrRouter();
