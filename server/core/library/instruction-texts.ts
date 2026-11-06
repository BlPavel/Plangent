import { moduleDependencies } from './dependencies';
import { readItemContent } from './library-manager';
import { availableLibraryItems, closestLibraryItem, resolveLibraryItem } from './section-settings';
import { getProject } from '../projects';
import type { InstructionTextState, InstructionTextSource, LibraryItem } from '../../../contracts';
import { isTextInstructionType } from '../../../common/library-registry';
import { DEFAULT_CODE_FIXER_INSTRUCTION, DEFAULT_COMMIT_RULES, DEFAULT_INSTRUCTION_GUIDE, DEFAULT_INTERVIEW_INSTRUCTION, DEFAULT_MR_REVIEW_INSTRUCTION, DEFAULT_PLAN_REVIEW_INSTRUCTION, DEFAULT_PLAN_TEMPLATE } from './builtins';

export { TEXT_INSTRUCTION_TYPES, isTextInstructionType, isGlobalOnlyType } from '../../../common/library-registry';
import { isGlobalOnlyType } from '../../../common/library-registry';
import type { TextInstructionType } from '../../../common/library-registry';
export type { TextInstructionType } from '../../../common/library-registry';

/** The slug of a text instruction is fixed: there is one of them per level. */
export const textInstructionSlug = (type: TextInstructionType) => type.replaceAll('-', '_');

export function defaultInstructionText(type: TextInstructionType): string {
  const kinds = Object.values(moduleDependencies.preparation.MATERIAL_KINDS);
  switch (type) {
    case 'instruction-guide': return DEFAULT_INSTRUCTION_GUIDE;
    case 'code-fixer-instruction': return DEFAULT_CODE_FIXER_INSTRUCTION;
    case 'commit-rules': return DEFAULT_COMMIT_RULES;
    case 'plan-review-instruction': return DEFAULT_PLAN_REVIEW_INSTRUCTION;
    case 'mr-review-instruction': return DEFAULT_MR_REVIEW_INSTRUCTION;
    case 'interview-instruction': return DEFAULT_INTERVIEW_INSTRUCTION;
    case 'plan-template': return DEFAULT_PLAN_TEMPLATE;
    default: {
      const kind = kinds.find(k => k.templateType === type || k.reviewInstructionType === type);
      return kind ? (kind.templateType === type ? kind.defaultTemplate : kind.defaultReviewInstruction) : '';
    }
  }
}

export interface InstructionText {
  type: TextInstructionType;
  slug: string;
  /** Where the text in force comes from; `default` is the built-in text. */
  level: 'direct' | 'group' | 'global' | 'default';
  item_id: string | null;
  global_only: boolean;
  content: string;
}

/** The text in force for a project: its own, its group's, the global one, otherwise the built-in. */
export function instructionTextFor(type: TextInstructionType, projectId: string, scope?: 'global' | 'project'): InstructionText {
  const globalOnly = isGlobalOnlyType(type);
  const item = resolveLibraryItem(type, globalOnly || scope === 'global' ? undefined : projectId);
  return {
    type, slug: item?.slug ?? textInstructionSlug(type), global_only: globalOnly,
    level: item ? ('origin' in item ? item.origin : 'global') : 'default',
    item_id: item?.id ?? null,
    content: item ? readItemContent(item) : defaultInstructionText(type),
  };
}

/** Editor state and agent reads share the same enabled/availability/priority rules. */
export function instructionTextState(type: string, scope: string, projectId?: string): InstructionTextState {
  if (typeof type !== 'string' || !isTextInstructionType(type)) throw new Error('Invalid instruction type');
  if (scope !== 'global' && scope !== 'project') throw new Error('Invalid scope');
  if (isGlobalOnlyType(type) && scope !== 'global') throw new Error('This instruction is global only');
  const project = scope === 'project' && projectId ? getProject(projectId) : null;
  if (scope === 'project' && (!project || project.kind === 'source')) throw new Error('A project or group is required');
  const items = availableLibraryItems(type, project?.id);
  const own = items.find(item => item.origin === (project ? 'direct' : 'global')) ?? null;
  const parent = project ? closestLibraryItem(items.filter(item => item.origin !== 'direct')) : null;
  const active = closestLibraryItem(items);
  const source = (item: LibraryItem | null): InstructionTextSource => {
    const level = !item ? 'default' : item.id === own?.id ? 'own' : item.origin === 'group' ? 'group' : 'global';
    const owner = level === 'own' ? project : level === 'group' && project?.group_id ? getProject(project.group_id) : null;
    return { level, item_id: item?.id ?? null, project_id: owner?.id ?? null, name: owner?.name ?? null };
  };
  const defaultContent = defaultInstructionText(type);
  return {
    content: active ? readItemContent(active) : defaultContent,
    source: source(active), own: own ? { ...own, content: readItemContent(own) } : null,
    default_content: defaultContent,
    inherited: parent ? { content: readItemContent(parent), source: source(parent) } : null,
  };
}
