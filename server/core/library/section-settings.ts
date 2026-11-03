import { readItemContent } from './library-manager';
import { getLibraryItem, libraryItemsFor, libraryOrigin, listLibraryItems } from './index';
import { getProject } from '../projects';
import type { LibraryOrigin } from './index';
import type { LibraryItemType } from '../../models';
import type { MaterialType } from '../materials';
import { MATERIAL_KINDS } from '../materials/kinds';

/** Settings shared by the plan and the other preparation sections; each section has its own item types. */
export interface ReviewSkill { id: string; title: string; description: string; origin: LibraryOrigin }

/** The text at the closest level: the project itself, then its group, then global; '' when there is none. */
export function resolveLevelText(type: LibraryItemType, projectId: string): string {
  const project = getProject(projectId);
  const items = project
    ? libraryItemsFor(project, type).filter(t => t.enabled)
    : listLibraryItems({ type, projectId: '', enabledOnly: true }).map(t => ({ ...t, origin: 'global' as const }));
  const item = (['direct', 'group', 'global'] as const).map(origin => items.find(t => t.origin === origin)).find(Boolean);
  return item ? readItemContent(item) : '';
}

/** The global instruction text of a type; without one the built-in text applies. */
export function resolveGlobalText(type: LibraryItemType, fallback: string): string {
  const item = listLibraryItems({ type, scope: 'global', enabledOnly: true })[0];
  return item ? readItemContent(item) : fallback;
}

/** Skills of a type that apply to a project: its own, its group's and global ones. */
export function reviewSkillsOf(type: LibraryItemType, projectId: string): ReviewSkill[] {
  const project = getProject(projectId);
  if (!project) return [];
  const order = { direct: 0, group: 1, global: 2 };
  return libraryItemsFor(project, type).filter(item => item.enabled)
    .sort((a, b) => order[a.origin] - order[b.origin])
    .map(item => ({ id: item.id, title: item.title, description: item.description, origin: item.origin }));
}

/** The chosen skill's text; an unknown or unavailable one falls back to the project's first skill, and without any there is none. */
export function resolveReviewSkillOf(type: LibraryItemType, projectId: string, skillId?: string | null): { id: string; title: string; content: string } | null {
  const project = getProject(projectId);
  const chosen = skillId ? getLibraryItem(skillId) : null;
  const item = chosen && chosen.type === type && chosen.enabled && project && libraryOrigin(chosen, project) ? chosen
    : (() => { const first = reviewSkillsOf(type, projectId)[0]; return first ? getLibraryItem(first.id) : null; })();
  return item ? { id: item.id, title: item.title, content: readItemContent(item) } : null;
}

/** "How to write" text of a section: the project's, group's or global one, otherwise the built-in. */
export function resolveMaterialTemplate(material: MaterialType, projectId: string): string {
  const kind = MATERIAL_KINDS[material];
  return resolveLevelText(kind.templateType, projectId) || kind.defaultTemplate;
}
export function resolveMaterialReviewInstruction(material: MaterialType): string {
  const kind = MATERIAL_KINDS[material];
  return resolveGlobalText(kind.reviewInstructionType, kind.defaultReviewInstruction);
}
export function materialReviewSkills(material: MaterialType, projectId: string): ReviewSkill[] {
  return reviewSkillsOf(MATERIAL_KINDS[material].reviewSkillType, projectId);
}
export function resolveMaterialReviewSkill(material: MaterialType, projectId: string, skillId?: string | null) {
  return resolveReviewSkillOf(MATERIAL_KINDS[material].reviewSkillType, projectId, skillId);
}
