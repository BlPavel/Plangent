import { Project } from '../../models';
import { groupMembers, listProjects } from './index';

export interface ReferenceEntry { key: string; name: string; path: string; description: string; kind: 'project' | 'source' }

/** Increment when existing sessions need to receive revised workspace instructions. */
export const WORKSPACE_BRIEFING_VERSION = 3;

const entry = (p: Project): ReferenceEntry => ({ key: p.key ?? '', name: p.name, path: p.repo_path, description: p.description, kind: p.kind === 'source' ? 'source' : 'project' });

/** Folders an agent of this project/group may change: the group's projects are its working set. */
export function writableRoots(project: Project): string[] {
  return project.kind === 'group' ? [project.repo_path, ...groupMembers(project.id).map(p => p.repo_path)] : [project.repo_path];
}

/**
 * Neighbouring work projects in the same group. Sources never join the automatic catalog:
 * they enter the prompt only through an explicit @mention.
 */
export function referenceCatalog(project: Project): ReferenceEntry[] {
  const neighbours = project.kind === 'project' && project.group_id
    ? groupMembers(project.group_id).filter(p => p.id !== project.id).map(entry) : [];
  return neighbours;
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
  if (project.kind !== 'group') {
    lines.push(`[Plangent] Active ${project.kind === 'source' ? 'reference source' : 'project'}: "${project.name}" (@${project.key}). Working directory: ${project.repo_path}`);
    if (project.description) lines.push(`Project description: ${project.description}`);
    lines.push('When the developer says "this project", "this application" or "here", they mean this active workspace unless they explicitly name another target. Base answers and session titles on the developer\'s request in this workspace.');
  }
  if (project.kind === 'group') {
    const members = groupMembers(project.id);
    lines.push(`[Plangent] You work in the project group "${project.name}". The current folder is only a service folder; the projects are:`);
    for (const p of members) lines.push(`- @${p.key} (${p.name}): ${p.repo_path}${p.description ? ` — ${p.description}` : ''}`);
    if (!members.length) lines.push('- (no projects yet)');
    lines.push('Make changes in those project folders. Open only what the task needs.');
  }
  lines.push('[Plangent] Reference sources are provided only when the developer explicitly mentions @key. Do not discover or use unmentioned sources. Answer questions about this application by inspecting the active workspace.');
  const catalog = referenceCatalog(project);
  if (catalog.length) {
    lines.push('[Plangent] Read-only reference material, not the active project. Availability does not make a reference the subject of the conversation. Do not read it up front: open it only when the task needs it or the developer mentions @key. Never edit it.');
    for (const r of catalog) lines.push(`- @${r.key}: ${r.path}${r.description ? ` — ${r.description}` : ''}`);
  }
  return lines.join('\n');
}

/** Only explicitly requested @keys enter the prompt; sharing alone does not add context. */
export function mentionedReferences(project: Project, text: string): string {
  const keys = new Set([...text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9._-]*)(?=\/|\s|$|[,;:!?])/gi)].map(match => match[1].toLowerCase()));
  if (!keys.size) return '';
  const selected = listProjects().filter(p => p.id !== project.id && p.kind !== 'group' && keys.has(p.key?.toLowerCase() ?? ''));
  if (!selected.length) return '';
  return ['[Plangent] The developer explicitly mentioned these external references. They are read-only; the active workspace above is unchanged.',
    ...selected.map(p => `- @${p.key} (${p.name}): ${p.repo_path}${p.description ? ` — ${p.description}` : ''}`)].join('\n');
}
