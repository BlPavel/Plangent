import { api } from '@core/api'
import type { MrPreview, TaskMr } from './types'
const root=(project:string)=>'/projects/'+encodeURIComponent(project)+'/task-mr'
export const taskMrApi={
 preview:(project:string,task?:string)=>api.post<MrPreview>(root(project)+'/preview',{task_id:task}),
 describe:(project:string,input:MrPreview)=>api.post<{description:string}>(root(project)+'/describe',input),
 create:(project:string,input:MrPreview)=>api.post<TaskMr>(root(project)+'/create',{...input,confirmed:true}),
 refresh:(project:string,task:string)=>api.post<TaskMr|null>(root(project)+'/refresh',{task_id:task}),
}
