import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { once } from 'node:events';
import type { CodeHost, MergeRequest, CreateMergeRequest } from '../../models/code-host';

test('manual task MR: preview, agent draft, confirmation, origin push, recovery and persisted status', async () => {
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'plangent-task-mr-'));
 process.env.PLANGENT_DATA_DIR=path.join(folder,'data');
 const {getDb,migrate}=await import('../../infrastructure/db/schema');
 const {createProject}=await import('../projects');
 const {createTask,updateTask,getTask}=await import('../tasks');
 const {createTaskMrService}=await import('./index');
 const {createTaskMrRouter}=await import('../../infrastructure/http/routes/task-mr');
 const {IntegrationError}=await import('../integrations');
 const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 const root=path.join(folder,'repo'),remote=path.join(folder,'origin.git');
 let http:ReturnType<typeof express.application.listen>|undefined;
 try{
  await fs.mkdir(root);git(root,'init','-b','main');git(root,'config','user.name','Developer');git(root,'config','user.email','developer@test.invalid');
  await fs.writeFile(path.join(root,'code.txt'),'base\n');git(root,'add','.');git(root,'commit','-m','base');
  git(folder,'init','--bare',remote);git(root,'remote','add','origin',remote);git(root,'push','origin','main');git(root,'fetch','origin');
  git(root,'branch','local-target');git(root,'switch','-c','feature/task');
  await fs.writeFile(path.join(root,'code.txt'),'changed\n');git(root,'add','.');git(root,'commit','-m','change');
  // Deliberately wrong upstream: creation must still publish origin/feature/task, never main.
  git(root,'branch','--set-upstream-to','origin/main');
  const db=getDb();migrate(db);
  const agent=db.prepare('SELECT id FROM agents LIMIT 1').get() as {id:string};
  const project=createProject({name:'Task MR',repo_path:root,default_agent_id:agent.id,git_settings:{base_branch:'main',mr_description_template:'{title} · {key} · {url}',mr_reviewers:['12'],mr_labels:['backend'],mr_squash:true}});
  const task=createTask({project_id:project.id,key:'Local-1',title:'Task title'});updateTask(task.id,{external_key:'PROJ-123',base_branch:'origin/main',branch_name:'feature/task',jira_url:'https://jira.test/PROJ-123'});
  const mainBefore=git(remote,'rev-parse','refs/heads/main');
  let creates=0,found:MergeRequest|null=null,createError:Error|undefined;
  const host={
    findMergeRequestForBranch:async(branch:string)=>found?.source_branch===branch?found:null,
    createMergeRequest:async(input:CreateMergeRequest)=>{creates++;if(createError)throw createError;found={...input,iid:7,description:input.description||'',web_url:'https://gitlab.test/team/repo/-/merge_requests/7',state:'opened',sha:git(root,'rev-parse','HEAD'),updated_at:'now',author:{id:1,name:'Developer',username:'dev'},diff_refs:{base_sha:mainBefore,start_sha:mainBefore,head_sha:git(root,'rev-parse','HEAD')}};return found},
    getMergeRequest:async(iid:number)=>{assert.equal(iid,7);return found!},
  } as unknown as CodeHost;
  const resolve=async()=>({host,connectionId:'connection',baseUrl:'https://gitlab.test',projectPath:'team/repo'});
  let generated=0;
  const service=createTaskMrService(resolve,async(_project,_agent,prompt)=>{generated++;assert.match(prompt,/PROJ-123/);assert.match(prompt,/changed/);assert.match(prompt,/Контекст задачи/);return 'Agent draft';});
  const preview=await service.preview(project.id,task.id);
  assert.equal(preview.target_branch,'main');assert.equal(preview.source_branch,'feature/task');assert.equal(preview.title,'PROJ-123 Task title');assert.match(preview.description!,/https:\/\/jira/);assert.deepEqual(preview.reviewer_ids,[12]);assert.equal(creates,0);
  assert.equal((await service.describe(project.id,preview)).description,'Agent draft');
  assert.equal((await service.describe(project.id,{...preview,target_branch:'local-target'})).description,'Agent draft');assert.equal(generated,2);
  await assert.rejects(service.create(project.id,preview,false),/Подтвердите/);assert.equal(creates,0);
  await assert.rejects(service.create(project.id,{...preview,head:'a'.repeat(40)},true),/изменились/);
  await assert.rejects(service.create(project.id,{...preview,connection_id:'different'},true),/изменились/);
  await fs.writeFile(path.join(root,'dirty.txt'),'dirty');await assert.rejects(service.create(project.id,preview,true),/закоммитьте/);await fs.unlink(path.join(root,'dirty.txt'));
  const edited={...preview,title:'PROJ-123 Edited by developer',description:'Human edited draft'};
  const mr=await service.create(project.id,edited,true);assert.equal(mr.title,edited.title);assert.equal(mr.description,edited.description);assert.equal(creates,1);
  assert.equal(git(remote,'rev-parse','refs/heads/feature/task'),preview.head);assert.equal(git(remote,'rev-parse','refs/heads/main'),mainBefore);
  const saved=JSON.parse(getTask(task.id)!.mr_link!);assert.equal(saved.url,mr.web_url);assert.equal(saved.state,'opened');
  assert.equal((await service.create(project.id,edited,true)).iid,7);assert.equal(creates,1);
  await assert.rejects(service.create(project.id,{...edited,target_branch:'local-target'},true),/уже существует/);
  found={...mr,state:'merged'};assert.equal((await service.refresh(project.id,task.id))!.state,'merged');assert.equal(JSON.parse(getTask(task.id)!.mr_link!).state,'merged');assert.equal(getTask(task.id)!.status,'open');
  // Ambiguous network response blocks a blind duplicate; a definitive remote 4xx allows correction.
  found=null;git(root,'switch','-c','feature/uncertain');updateTask(task.id,{branch_name:'feature/uncertain'});
  const uncertain=await service.preview(project.id,task.id);createError=new Error('network lost');await assert.rejects(service.create(project.id,uncertain,true),/network lost/);const count=creates;
  await assert.rejects(service.create(project.id,uncertain,true),/неизвестен/);assert.equal(creates,count);
  git(root,'switch','-c','feature/rejected');updateTask(task.id,{branch_name:'feature/rejected'});const rejected=await service.preview(project.id,task.id);
  createError=Object.assign(new Error('remote validation'),{remote_status:400});await assert.rejects(service.create(project.id,rejected,true),/remote validation/);
  createError=undefined;assert.equal((await service.create(project.id,rejected,true)).state,'opened');
  const app=express();app.use(express.json({strict:false}));app.use('/projects/:projectId/task-mr',createTaskMrRouter(()=>service));http=app.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address() as {port:number};
  const post=async(action:string,body:unknown)=>fetch('http://127.0.0.1:'+address.port+'/projects/'+project.id+'/task-mr/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('create',null)).status,400);assert.equal((await post('refresh',{})).status,400);assert.equal((await post('create',{...rejected,confirmed:false})).status,400);
  const otherRoot=path.join(folder,'other');await fs.mkdir(otherRoot);const other=createTask({project_id:createProject({name:'Other',repo_path:otherRoot}).id,key:'Other'});assert.equal((await post('preview',{task_id:other.id})).status,404);
  const failing=createTaskMrService(async()=>{throw new IntegrationError('Token expired','auth',401)});app.use('/failure/:projectId',createTaskMrRouter(()=>failing));
  const response=await fetch('http://127.0.0.1:'+address.port+'/failure/'+project.id+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);assert.match(await response.text(),/Token expired/);
 }finally{await new Promise<void>(resolve=>http?http.close(()=>resolve()):resolve());getDb().close();await fs.rm(folder,{recursive:true,force:true});}
});
