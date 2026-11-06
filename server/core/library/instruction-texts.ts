import type { LibraryItemType } from '../../models';
import { moduleDependencies } from './dependencies';
import { readItemContent } from './library-manager';
import { resolveLibraryItem } from './section-settings';
import { DEFAULT_CODE_FIXER_INSTRUCTION, DEFAULT_COMMIT_RULES, DEFAULT_INSTRUCTION_GUIDE, DEFAULT_INTERVIEW_INSTRUCTION, DEFAULT_MR_REVIEW_INSTRUCTION, DEFAULT_PLAN_REVIEW_INSTRUCTION } from './builtins';

/** Library items that are one editable text per level (not a list): the developer edits them in the settings or the project's «Инструкции». */
export const TEXT_INSTRUCTION_TYPES = [
  'instruction-guide', 'code-fixer-instruction', 'commit-rules', 'plan-template', 'plan-review-instruction', 'mr-review-instruction', 'interview-instruction',
  'architecture-template', 'architecture-review-instruction', 'qa-template', 'qa-review-instruction',
] as const satisfies readonly LibraryItemType[];
export type TextInstructionType = typeof TEXT_INSTRUCTION_TYPES[number];

export const isTextInstructionType = (type: string): type is TextInstructionType => (TEXT_INSTRUCTION_TYPES as readonly string[]).includes(type);

/** Texts that exist only at the global level. */
export function isGlobalOnlyType(type: string): boolean {
  const kinds = Object.values(moduleDependencies.preparation.MATERIAL_KINDS);
  return type === 'interview-instruction' || type === 'plan-review-instruction' || type === 'mr-review-instruction' || kinds.some(kind => kind.reviewInstructionType === type);
}

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
    case 'plan-template': return '';
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
