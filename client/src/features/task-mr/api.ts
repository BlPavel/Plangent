import type { Endpoints } from '@contracts'
import { api } from '@core/api'
import type { MrPreview} from './types'
const root=(project:string)=>'/projects/'+encodeURIComponent(project)+'/task-mr'
export const taskMrApi={
 preview:(project:string,task?:string)=>api.post<Endpoints['POST /api/projects/:projectId/task-mr/preview']['response']>(root(project)+'/preview',{task_id:task}),
 describe:(project:string,input:MrPreview)=>api.post<Endpoints['POST /api/projects/:projectId/task-mr/describe']['response']>(root(project)+'/describe',input),
 create:(project:string,input:MrPreview)=>api.post<Endpoints['POST /api/projects/:projectId/task-mr/create']['response']>(root(project)+'/create',{...input,confirmed:true}),
 refresh:(project:string,task:string)=>api.post<Endpoints['POST /api/projects/:projectId/task-mr/refresh']['response']>(root(project)+'/refresh',{task_id:task}),
}
