import { moduleDependencies } from './dependencies';
import { randomUUID } from 'crypto';
import { getProposalRow, listProposalRows, insertProposal, updateProposalStatus, libraryTransaction } from '../../infrastructure/db/repositories/library/proposals';
import type { LibraryItem, LibraryItemType, LibraryProposal, LibraryScope } from '../../models';
import { getProject } from '../projects';
import type { getSession } from '../agents';
import { broadcast } from '../shared';
import { createLibraryItem, getLibraryItem, libraryItemsFor, libraryOrigin, listLibraryItems, setExcluded, updateLibraryItem } from './index';
import { readItemContent, writeItemContent, deleteItemContent } from './library-manager';
import { syncItem, unsyncItem } from './syncer';
import { resolveInstructionGuide } from './instruction-guide';
import { librarianTargetTypes } from './chat-context';
import { defaultInstructionText, instructionTextFor, isGlobalOnlyType, isTextInstructionType, textInstructionSlug, TEXT_INSTRUCTION_TYPES } from './instruction-texts';

export interface ProposalInput {
  action: 'create' | 'update';
  type: LibraryProposal['type'];
  /** Ignored for text instructions: their slug is fixed. */
  slug: string;
  title: string;
  description?: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  explanation: string;
  item_id?: string;
  scope?: LibraryScope;
  targets?: string[];
  own_only?: string[];
}
export interface ProposalAvailability { scope: LibraryScope; targets: string[]; own_only?: string[] }
export class ProposalConflict extends Error {}
function parse(row: unknown): LibraryProposal {
  const { data, ...rest } = row as Record<string, unknown>;
  const proposal = { ...JSON.parse(String(data)), ...rest } as unknown as LibraryProposal;
  // Legacy creates had no snapshot even when they replaced a built-in instruction.
  proposal.base_content ??= proposal.snapshot?.content ?? (isTextInstructionType(proposal.type) ? defaultInstructionText(proposal.type) : '');
  return proposal;
}
export function getProposal(id: string): LibraryProposal {
  const row = getProposalRow(id);
  if (!row) throw new Error('Proposal not found');
  return parse(row);
}
export function listProposals(filters: { projectId?: string; sessionId?: string } = {}): LibraryProposal[] {
  return listProposalRows(filters).map(parse);
}
function snapshot(item: LibraryItem): LibraryItem & { content: string } {
  return { ...item, content: readItemContent(item) };
}
/** What the librarian may propose: list items and the single text instructions. */
export const PROPOSAL_TYPES: readonly LibraryItemType[] = ['skill', 'main', 'command', 'review-skill', 'plan-review-skill', 'architecture-review-skill', 'qa-review-skill', ...TEXT_INSTRUCTION_TYPES];
function validate(data: ProposalInput): void {
  if (!['create', 'update'].includes(data.action)) throw new Error('Invalid action');
  if (!PROPOSAL_TYPES.includes(data.type)) throw new Error('Invalid library type');
  if (typeof data.slug !== 'string' || (!isTextInstructionType(data.type) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))) throw new Error('Invalid slug: use kebab-case');
  for (const key of ['title', 'content', 'explanation'] as const)
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error('Invalid ' + key);
  if (data.description !== undefined && typeof data.description !== 'string') throw new Error('Invalid description');
  if (data.frontmatter !== undefined && (!data.frontmatter || typeof data.frontmatter !== 'object' || Array.isArray(data.frontmatter))) throw new Error('Invalid frontmatter');
}
function availability(data: ProposalAvailability): Required<ProposalAvailability> {
  if (!['global', 'project'].includes(data.scope)) throw new Error('Invalid scope');
  if (!Array.isArray(data.targets) || data.targets.some(id => typeof id !== 'string' || !getProject(id) || getProject(id)!.kind === 'source')) throw new Error('Invalid targets');
  const own = data.own_only ?? [];
  if (!Array.isArray(own) || own.some(id => !data.targets.includes(id) || getProject(id)?.kind !== 'group')) throw new Error('Invalid own_only');
  if (data.scope === 'project' && !data.targets.length) throw new Error('Project scope requires targets');
  if (data.scope === 'global' && (data.targets.length || own.length)) throw new Error('Global scope has no targets');
  return { scope: data.scope, targets: [...new Set(data.targets)], own_only: [...new Set(own)] };
}
function notify(proposal: LibraryProposal): LibraryProposal {
  broadcast({ type: 'library_proposal', proposal });
  return proposal;
}
export function proposeLibraryChange(sessionId: string, input: ProposalInput): LibraryProposal {
  const session = moduleDependencies.agents.getSession(sessionId), project = getProject(session.project_id);
  if (session.role !== 'librarian' || !project || project.kind === 'source') throw new Error('A librarian project session is required');
  const targetTypes = librarianTargetTypes(session.metadata);
  if (targetTypes.length && !targetTypes.includes(input.type)) throw new Error(`This chat edits ${targetTypes.join(', ')}. Read the target instruction and propose a change of the matching type.`);
  const item = input.action === 'update' ? getLibraryItem(String(input.item_id ?? '')) : null;
  if (session.metadata.library_scope === 'global') {
    if (item && item.scope !== 'global') throw new Error('This chat edits global instructions. Read the global instruction with get_instruction_text before proposing a change.');
    input = { ...input, scope: 'global', targets: [], own_only: [] };
  }
  if (isTextInstructionType(input.type)) input = { ...input, slug: item?.slug ?? textInstructionSlug(input.type) };
  validate(input);
  if (input.action === 'update' && (!item || !libraryOrigin(item, project))) throw new Error('Library item is not available in this project');
  if (item && (input.type !== item.type || input.slug !== item.slug)) throw new Error('Updates must preserve type and slug');
  if (input.action === 'create' && input.item_id !== undefined) throw new Error('Create must not specify item_id');
  const shared = item && libraryOrigin(item, project) === 'group';
  const scope = input.scope ?? (isGlobalOnlyType(input.type) ? 'global' : shared ? 'project' : item?.scope ?? 'project');
  const access = availability({
    scope,
    targets: input.targets ?? (scope === 'global' ? [] : shared ? [project.id] : item?.targets ?? [project.id]),
    own_only: input.own_only ?? (scope === 'global' || shared ? [] : item?.own_only ?? []),
  });
  const before = item ? snapshot(item) : null;
  const baseContent = before?.content ?? (isTextInstructionType(input.type) ? instructionTextFor(input.type, project.id, scope).content : '');
  const data = { ...input, description: input.description ?? item?.description ?? '', frontmatter: input.frontmatter ?? item?.frontmatter ?? {},
    ...access, item_id: item?.id ?? null, snapshot: before, base_content: baseContent };
  const id = randomUUID();
  insertProposal(id, project.id, session.id, JSON.stringify(data));
  return notify(getProposal(id));
}
function setStatus(id: string, status: LibraryProposal['status'], appliedId?: string): LibraryProposal {
  updateProposalStatus(id, status, appliedId);
  return getProposal(id);
}
export function rejectProposal(id: string): LibraryProposal {
  const p = getProposal(id);
  if (p.status !== 'pending') throw new ProposalConflict('Proposal is ' + p.status);
  return notify(setStatus(id, 'rejected'));
}
export function applyProposal(id: string, override?: ProposalAvailability): LibraryItem & { content: string } {
  const p = getProposal(id);
  if (p.status !== 'pending') throw new ProposalConflict('Proposal is ' + p.status);
  const project = getProject(p.project_id);
  if (!project) throw new Error('Project not found');
  const before = p.item_id ? getLibraryItem(p.item_id) : null;
  if (p.action === 'update' && (!before || JSON.stringify(snapshot(before)) !== JSON.stringify(p.snapshot))) {
    notify(setStatus(id, 'stale'));
    throw new ProposalConflict('Proposal is stale: the library item changed');
  }
  validate({ ...p, item_id: p.item_id ?? undefined });
  const access = availability(override ?? p);
  if (isGlobalOnlyType(p.type) && access.scope !== 'global') throw new Error('This instruction is global only');
  const detached = before && libraryOrigin(before, project) === 'group';
  if (detached && (access.scope !== 'project' || access.targets.length !== 1 || access.targets[0] !== project.id || access.own_only.length))
    throw new Error('A shared group item must be detached into this project');
  const clashes = listLibraryItems({ type: p.type }).filter(i => i.id !== before?.id);
  if ((p.type === 'main' || isTextInstructionType(p.type)) && clashes.some(i => i.scope === access.scope && (access.scope === 'global' || i.targets.some(t => access.targets.includes(t)))))
    throw new ProposalConflict('A main file or instruction text already exists at this level');
  if (p.action === 'create' && !isTextInstructionType(p.type) && listLibraryItems({ type: p.type }).some(i => i.slug === p.slug && !i.detached_from))
    throw new ProposalConflict('A library item with this slug already exists');
  let result: LibraryItem | undefined;
  try {
    libraryTransaction(() => {
      const fields = { type: p.type, slug: p.slug, title: p.title, description: p.description, frontmatter: p.frontmatter, ...access };
      result = before && !detached ? updateLibraryItem(before.id, fields)! : createLibraryItem({
        ...fields, ...(before ? { detached_from: before.id, enabled: before.enabled, agent_filter: before.agent_filter } : {}),
      });
      writeItemContent(result, p.content);
      if (before) {
        unsyncItem(before, detached ? [project] : undefined);
        if (detached) setExcluded(before.id, project.id, true);
      }
      syncItem(result);
      setStatus(id, 'applied', result.id);
    })();
  } catch (error) {
    // Restore disk content after database rollback; keep the pending proposal available for retry.
    if (result) {
      if (before && !detached) writeItemContent(before, p.snapshot!.content);
      else deleteItemContent(result);
      try { unsyncItem(result); if (before) syncItem(before); } catch { /* preserve original error */ }
    }
    throw error;
  }
  notify(getProposal(id));
  broadcast({ type: 'library_changed', projectId: project.id, item: result });
  return { ...result!, content: p.content };
}
export function libraryToolContext(projectId: string): Record<string, unknown> {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');
  return {
    items: libraryItemsFor(project).map(item => ({ id: item.id, type: item.type, slug: item.slug, title: item.title, description: item.description,
      origin: item.origin, shared: item.origin === 'group', scope: item.scope, targets: item.targets, own_only: item.own_only, enabled: item.enabled })),
    guide: resolveInstructionGuide(projectId),
    levels: [{ id: project.id, name: project.name, kind: project.kind },
      ...(project.group_id ? [{ id: project.group_id, name: getProject(project.group_id)?.name, kind: 'group' }] : []),
      { id: null, name: 'Global', kind: 'global' }],
  };
}
export function libraryToolItem(projectId: string, id: string): LibraryItem & { content: string } {
  const project = getProject(projectId), item = getLibraryItem(id);
  if (!project || !item || !libraryOrigin(item, project)) throw new Error('Library item is not available in this project');
  return snapshot(item);
}
