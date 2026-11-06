import type { LibraryItem, LibraryScope } from '../../models';
import { LIBRARY_TYPES, isLibraryItemType, isTextInstructionType } from '../../../common/library-registry';
import { getProject } from '../projects';
import { broadcast } from '../shared';
import { createLibraryItem, updateLibraryItem, deleteLibraryItem, getLibraryItem, listLibraryItems, setExcluded, libraryOrigin, setLibraryOverride, deleteLibraryOverride, libraryTransaction } from './index';
import { readItemContent, writeItemContent, deleteItemContent, writeOverrideContent, deleteOverrideContent, transferItemFiles } from './library-manager';
import { syncItem, unsyncItem } from './syncer';
import { withLibraryFiles } from './file-transaction';

export class LibraryOperationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export interface LibraryAvailability { scope: LibraryScope; targets: string[]; own_only?: string[] }
export function validateLibraryAvailability(data: LibraryAvailability): Required<LibraryAvailability> {
  if (!data || !['global', 'project'].includes(data.scope)) throw new LibraryOperationError('Invalid scope');
  if (!Array.isArray(data.targets) || data.targets.some(id => typeof id !== 'string' || !getProject(id) || getProject(id)!.kind === 'source')) throw new LibraryOperationError('Invalid targets');
  const own = data.own_only ?? [];
  if (!Array.isArray(own) || own.some(id => !data.targets.includes(id) || getProject(id)?.kind !== 'group')) throw new LibraryOperationError('Invalid own_only');
  if (data.scope === 'project' && !data.targets.length) throw new LibraryOperationError('Project scope requires targets');
  if (data.scope === 'global' && (data.targets.length || own.length)) throw new LibraryOperationError('Global scope has no targets');
  return { scope: data.scope, targets: [...new Set(data.targets)], own_only: [...new Set(own)] };
}
type Fields = Parameters<typeof createLibraryItem>[0] & { content?: string };
type Changes = Partial<Fields>;
function validate(fields: Fields, before?: LibraryItem, detached = false): void {
  if (typeof fields.type !== 'string' || !isLibraryItemType(fields.type)) throw new LibraryOperationError('Invalid library type');
  if (!LIBRARY_TYPES[fields.type].scopes.includes(fields.scope)) throw new LibraryOperationError('This instruction is global only');
  if (typeof fields.slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(fields.slug)) throw new LibraryOperationError('Invalid slug');
  if (typeof fields.title !== 'string' || !fields.title.trim()) throw new LibraryOperationError('title required');
  if (fields.content !== undefined && typeof fields.content !== 'string') throw new LibraryOperationError('Invalid content');
  if (fields.description !== undefined && typeof fields.description !== 'string') throw new LibraryOperationError('Invalid description');
  if (fields.enabled !== undefined && typeof fields.enabled !== 'boolean') throw new LibraryOperationError('Invalid enabled');
  if (fields.agent_filter !== undefined && (!Array.isArray(fields.agent_filter) || fields.agent_filter.some(id => typeof id !== 'string'))) throw new LibraryOperationError('Invalid agent_filter');
  if (fields.frontmatter !== undefined && (!fields.frontmatter || typeof fields.frontmatter !== 'object' || Array.isArray(fields.frontmatter))) throw new LibraryOperationError('Invalid frontmatter');
  const clashes = listLibraryItems({ type: fields.type }).filter(item => item.id !== before?.id);
  if (LIBRARY_TYPES[fields.type].singlePerLevel && clashes.some(item => item.scope === fields.scope && (fields.scope === 'global' || item.targets.some(id => fields.targets!.includes(id)))))
    throw new LibraryOperationError('A main file or instruction text already exists at this level', 409);
  if (!detached && fields.type !== 'main' && !isTextInstructionType(fields.type) && (!before || fields.slug !== before.slug || fields.type !== before.type) && clashes.some(item => item.slug === fields.slug && !item.detached_from))
    throw new LibraryOperationError('A library item with this slug already exists', 409);
}
function requiredItem(id: string): LibraryItem {
  const item = getLibraryItem(id);
  if (!item) throw new LibraryOperationError('Not found', 404);
  return item;
}
function sharedProject(item: LibraryItem, projectId: string) {
  if (typeof projectId !== 'string' || !projectId) throw new LibraryOperationError('projectId required');
  const project = getProject(projectId);
  if (!project) throw new LibraryOperationError('Project not found', 404);
  if (!libraryOrigin(item, project) || !project.group_id || !item.targets.includes(project.group_id)) throw new LibraryOperationError('Элемент не получен через группу');
  return project;
}

/** A callback joins proposal status to the save transaction, after all disk writes succeed. */
export function saveLibraryItem(data: Changes, options: { id?: string; projectId?: string; afterSave?: (item: LibraryItem) => void } = {}): LibraryItem & { content: string } {
  const before = options.id ? requiredItem(options.id) : undefined;
  const project = before && options.projectId ? sharedProject(before, options.projectId) : undefined;
  const fields = { ...before, ...data } as Fields;
  const access = validateLibraryAvailability({ scope: fields.scope, targets: fields.targets ?? (fields.scope === 'project' && before?.project_id ? [before.project_id] : []), own_only: fields.own_only });
  Object.assign(fields, access);
  if (project && (fields.scope !== 'project' || access.targets.length !== 1 || access.targets[0] !== project.id || access.own_only.length)) throw new LibraryOperationError('A shared group item must be detached into this project');
  validate(fields, before, !!project || !!before?.detached_from);
  const content = data.content ?? (before ? readItemContent(before) : '');
  const result = withLibraryFiles(() => libraryTransaction(() => {
    // Remove the old installation before changing its identity or availability.
    if (before) unsyncItem(before, project ? [project] : undefined);
    const item = before && !project ? updateLibraryItem(before.id, fields)! : createLibraryItem({ ...fields, detached_from: project ? before!.id : null });
    if (before) for (const agent of transferItemFiles(before, item, !!project)) setLibraryOverride(item.id, agent, agent);
    writeItemContent(item, content);
    if (project) setExcluded(before!.id, project.id, true);
    syncItem(item);
    options.afterSave?.(item);
    return { ...item, content };
  })());
  broadcast({ type: 'library_changed', projectId: options.projectId ?? result.targets[0] ?? '', item: result });
  return result;
}
export function detachLibraryItem(id: string, projectId: string, changes: Changes = {}) {
  const before = requiredItem(id);
  return saveLibraryItem({ ...changes, scope: 'project', targets: [projectId], own_only: [] }, { id: before.id, projectId });
}
export function excludeLibraryItem(id: string, projectId: string): void {
  if (typeof projectId !== 'string' || !projectId) throw new LibraryOperationError('projectId required');
  removeLibraryItem(id, projectId);
}
export function removeLibraryItem(id: string, projectId?: string): void {
  const item = requiredItem(id);
  const project = projectId !== undefined ? sharedProject(item, projectId) : undefined;
  withLibraryFiles(() => libraryTransaction(() => {
    unsyncItem(item, project ? [project] : undefined);
    if (project) setExcluded(item.id, project.id, true);
    else { deleteItemContent(item); deleteLibraryItem(item.id); }
  })());
  broadcast({ type: 'library_changed', projectId: projectId ?? item.targets[0] ?? '', item });
}

export function saveLibraryOverride(id: string, agentType: string, content: string): void {
  if (typeof content !== 'string') throw new LibraryOperationError('content required');
  changeLibraryOverride(id, agentType, content);
}
export function removeLibraryOverride(id: string, agentType: string): void {
  changeLibraryOverride(id, agentType, null);
}
function changeLibraryOverride(id: string, agentType: string, content: string | null): void {
  const item = requiredItem(id);
  if (typeof agentType !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(agentType)) throw new LibraryOperationError('Invalid agent type');
  withLibraryFiles(() => libraryTransaction(() => {
    unsyncItem(item);
    if (content === null) {
      deleteOverrideContent(item, agentType);
      deleteLibraryOverride(item.id, agentType);
    } else {
      writeOverrideContent(item, agentType, content);
      setLibraryOverride(item.id, agentType, agentType);
    }
    syncItem(item);
  })());
  broadcast({ type: 'library_changed', projectId: item.targets[0] ?? '', item });
}
