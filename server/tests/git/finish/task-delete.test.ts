import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a task whose working folder was used by a finish can be deleted, and its unfinished finish is cancelled', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-task-delete-'));
  process.env.PLANGENT_DATA_DIR = path.join(folder, 'data');
  const { getDb, migrate } = await import('../../../core-services').then(() => import('../../../infrastructure/db/schema'));
  const { deletedDeleteTasks } = await import('../../../infrastructure/db/repositories/tasks');
  const { getFinish, activeFinish } = await import('../../../core-services').then(() => import('../../../core/git/finish/index'));
  const db = getDb();
  try {
    db.prepare("INSERT INTO projects(id,kind,name,key,repo_path) VALUES ('p','project','P','p','/x')").run();
    const insertFinish = db.prepare("INSERT INTO finish_runs(id,project_id,task_id,scenario,options,base_head,branch,snapshot_tree,stage,status,workspace_id) VALUES (?,?,?,'commits','{\"task_id\":\"t\"}','h','b','s',?,?,'w')");
    db.prepare("INSERT INTO tasks(id,project_id,key) VALUES ('t','p','K-1')").run();
    db.prepare("INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,status) VALUES ('w','p','t','b','main','/w','removed')").run();
    insertFinish.run('done', 'p', 't', 'done', 'complete');
    assert.equal(deletedDeleteTasks('t').changes, 1);
    assert.equal(getFinish('done').status, 'complete');
    assert.equal(getFinish('done').task_id, null);

    // A finish that was still open when its task went: it can never continue, and must not count as the project's active finish.
    db.prepare("INSERT INTO tasks(id,project_id,key) VALUES ('t','p','K-2')").run();
    db.prepare("INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,status) VALUES ('w','p','t','b','main','/w','removed')").run();
    insertFinish.run('open', 'p', 't', 'commits', 'error');
    deletedDeleteTasks('t');
    assert.equal(activeFinish('p'), null);
    migrate(db);
    assert.equal(getFinish('open').status, 'cancelled', 'the next start of the application closes it for good');
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
