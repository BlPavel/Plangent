import { busyRecords } from '../../../infrastructure/db/repositories/git/busy';
import { getWorkspace } from '../../workspaces';
import { getProject } from '../../projects';
import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '../../../models/domain-error';

/** Finish workflows own Git state; ordinary agent sessions do not lock user actions. */
export function assertRepositoryIdle(projectId: string, exceptFinishId?: string, selectedRoot?: string): void {
  const project = getProject(projectId);
  if (!project) throw new DomainError('Project not found', 404);
  const canonical = (root: string) => { try { const resolved = fs.realpathSync(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } catch { const resolved = path.resolve(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } };
  const root = canonical(selectedRoot ?? project.repo_path);
  
  if (!busyRecords.hasFinishTable()) return;
  const runs = busyRecords.listActiveFinishes(exceptFinishId ?? '') as { project_id: string; workspace_id: string | null }[];
  if (runs.some(run => canonical(run.workspace_id ? getWorkspace(run.workspace_id).path : getProject(run.project_id)!.repo_path) === root))
    throw new DomainError('Идёт завершение работ в этом репозитории', 409);
}
