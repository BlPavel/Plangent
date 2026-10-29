import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../../infrastructure/db/schema';
import type { Workspace } from '../../models';
import { getProject } from '../projects';
import { runGit } from '../code/git-write';
import { updateWorkspace } from './store';
export async function recoverWorkspaces() {
  const rows = getDb().prepare("SELECT * FROM workspaces WHERE status<>'removed'").all() as Workspace[];
  const projects = new Map<string, string>();
  for (const workspace of rows) {
    try {
      if (workspace.status === 'preparing') throw new Error('Подготовка прервана перезапуском. Пересоздайте рабочее место.');
      if (workspace.status === 'failed') continue;
      if (!projects.has(workspace.project_id)) {
        const project = getProject(workspace.project_id);
        if (!project) throw new Error('Проект не найден');
        projects.set(workspace.project_id, await runGit(project.repo_path, ['worktree', 'list', '--porcelain']));
      }
      const canonical = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
      const record = projects.get(workspace.project_id)!.split(/\r?\n\r?\n/).find(block => {
        const folder = block.split(/\r?\n/).find(line => line.startsWith('worktree '))?.slice(9);
        return folder && canonical(folder) === canonical(workspace.path);
      });
      if (!record || !record.split(/\r?\n/).includes('branch refs/heads/' + workspace.branch)
        || !(await fs.stat(workspace.path).then(stat => stat.isDirectory(), () => false)))
        throw new Error('Папка рабочего места или его ветка не найдена. Пересоздайте рабочее место.');
    } catch (error) {
      updateWorkspace(workspace.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
}
