import { Project } from '../../models';
import { groupMembers, listProjects } from './index';

export interface ReferenceEntry { key: string; name: string; path: string; description: string; kind: 'project' | 'source' }

const entry = (p: Project): ReferenceEntry => ({ key: p.key ?? '', name: p.name, path: p.repo_path, description: p.description, kind: p.kind === 'source' ? 'source' : 'project' });

/** Folders an agent of this project/group may change: the group's projects are its working set. */
export function writableRoots(project: Project): string[] {
  return project.kind === 'group' ? [project.repo_path, ...groupMembers(project.id).map(p => p.repo_path)] : [project.repo_path];
}

/** Whether a source is shared with this project, directly or through its group. */
export function sourceAvailable(source: Project, project: Project): boolean {
  if (source.config.available_everywhere) return true;
  const targets = source.targets ?? [];
  return targets.includes(project.id) || (!!project.group_id && targets.includes(project.group_id));
}

/**
 * What the agent is told exists, without reading any of it: available sources and, for a project in a group,
 * its neighbours (read-only). Anything else is reachable only through an explicit @mention.
 */
export function referenceCatalog(project: Project): ReferenceEntry[] {
  const sources = listProjects('source').filter(s => sourceAvailable(s, project)).map(entry);
  const neighbours = project.kind === 'project' && project.group_id
    ? groupMembers(project.group_id).filter(p => p.id !== project.id).map(entry) : [];
  return [...neighbours, ...sources];
}

/** Source folders: agents only read them, so edits there are refused outright. */
export function readOnlyRoots(): string[] {
  return listProjects('source').map(s => s.repo_path);
}

/**
 * The hidden note sent with a session's first message. Only keys, paths and one-line descriptions: the
 * folders themselves are read on demand so they do not fill the context.
 */
export function workspaceBriefing(project: Project): string {
  const lines: string[] = [];
  if (project.kind === 'group') {
    const members = groupMembers(project.id);
    lines.push(`[Plangent] You work in the project group "${project.name}". The current folder is only a service folder; the projects are:`);
    for (const p of members) lines.push(`- @${p.key} (${p.name}): ${p.repo_path}${p.description ? ` — ${p.description}` : ''}`);
    if (!members.length) lines.push('- (no projects yet)');
    lines.push('Make changes in those project folders. Open only what the task needs.');
  }
  const catalog = referenceCatalog(project);
  if (catalog.length) {
    lines.push('[Plangent] Read-only reference material. Do not read it up front: open it only when the task needs it or the developer mentions @key. Never edit it.');
    for (const r of catalog) lines.push(`- @${r.key}: ${r.path}${r.description ? ` — ${r.description}` : ''}`);
  }
  return lines.join('\n');
}
