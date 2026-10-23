import { getDb } from '../../infrastructure/db/schema';
import { listProjects, getProject } from '../projects';
import fs from 'node:fs';
import path from 'node:path';
import { CodeError } from './files';

/** Finish workflows own Git state; ordinary agent sessions do not lock user actions. */
export function assertRepositoryIdle(projectId: string, exceptFinishId?: string): void {
  const project = getProject(projectId);
  if (!project) throw new CodeError('Project not found', 404);
  const canonical = (root: string) => { try { const resolved = fs.realpathSync(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } catch { const resolved = path.resolve(root); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; } };
  const root = canonical(project.repo_path);
  const projects = listProjects().filter(p => p.kind === 'project' && canonical(p.repo_path) === root);
  const ids = [...new Set(projects.flatMap(p => [p.id, ...(p.group_id ? [p.group_id] : [])]))];
  const db = getDb();
  for (const id of ids) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='finish_runs'").get() &&
        db.prepare("SELECT 1 FROM finish_runs WHERE project_id=? AND status NOT IN ('complete','cancelled') AND id<>? LIMIT 1").get(id, exceptFinishId ?? ''))
      throw new CodeError('Идёт завершение работ в этом репозитории', 409);
  }
}
