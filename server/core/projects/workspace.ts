import { Project } from '../../models';
import { groupMembers, listProjects } from './index';

/** Folders an agent of this project/group may change: the group's projects are its working set. */
export function writableRoots(project: Project): string[] {
  return project.kind === 'group' ? [project.repo_path, ...groupMembers(project.id).map(p => p.repo_path)] : [project.repo_path];
}

/** Source folders: agents only read them, so edits there are refused outright. */
export function readOnlyRoots(): string[] {
  return listProjects('source').map(s => s.repo_path);
}

/** Only explicitly requested @keys enter the prompt; sharing alone does not add context. */
export function mentionedReferences(project: Project, text: string): string {
  const keys = new Set([...text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]*)(?=\/|\s|$|[,;:!?])/gi)].map(match => match[1].toLowerCase()));
  if (!keys.size) return '';
  const selected = listProjects().filter(p => p.id !== project.id && p.kind !== 'group' && keys.has(p.key?.toLowerCase() ?? ''));
  if (!selected.length) return '';
  return ['[Plangent] The developer explicitly mentioned these external references. They are read-only; the current working directory is unchanged.',
    ...selected.map(p => `- @${p.key} (${p.name}): ${p.repo_path}${p.description ? ` — ${p.description}` : ''}`)].join('\n');
}
