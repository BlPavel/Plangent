import { getWorkspace } from '../workspaces/store';
﻿import { getDb } from '../../infrastructure/db/schema';
import { getProject } from '../projects';
import fs from 'node:fs';
import path from 'node:path';
import { CodeError } from './files';

/** Finish workflows own Git state; ordinary agent sessions do not lock user actions. */
export function assertRepositoryIdle(projectId: string, exceptFinishId?: string, selectedRoot?: string): void {
  const project = getProject(projectId);
  if (!project) throw new CodeError('Project not found', 404);
  const canonical = (root: string) => { try { const resolved = fs.realpathSync(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } catch { const resolved = path.resolve(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } };
  const root = canonical(selectedRoot ?? project.repo_path);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='finish_runs'").get()) return;
  const runs = db.prepare("SELECT project_id,workspace_id FROM finish_runs WHERE status NOT IN ('complete','cancelled') AND id<>?")
    .all(exceptFinishId ?? '') as { project_id: string; workspace_id: string | null }[];
  if (runs.some(run => canonical(run.workspace_id ? getWorkspace(run.workspace_id).path : getProject(run.project_id)!.repo_path) === root))
    throw new CodeError('Идёт завершение работ в этом репозитории', 409);
}
