import type { LibraryItem, LibraryItemType, Project } from '../../models';
import { listLibraryItems } from '../../infrastructure/db/repositories/library';
export * from '../../infrastructure/db/repositories/library';

/** How an item reaches a project: everywhere, through the project's group, or directly. */
export type LibraryOrigin = 'global' | 'group' | 'direct';

export function libraryOrigin(item: LibraryItem, project: Project): LibraryOrigin | null {
  if (item.scope === 'global') return 'global';
  if (item.excluded.includes(project.id)) return null;
  if (item.targets.includes(project.id)) return 'direct';
  if (project.group_id && item.targets.includes(project.group_id) && !item.own_only.includes(project.group_id)) return 'group';
  return null;
}

/** Items that apply to a project or group, with where each comes from. */
export function libraryItemsFor(project: Project, type?: LibraryItemType): (LibraryItem & { origin: LibraryOrigin })[] {
  return listLibraryItems({ type }).flatMap(item => {
    const origin = libraryOrigin(item, project);
    return origin ? [{ ...item, origin }] : [];
  });
}


export { buildCodeFixerBriefing } from './code-fixer-instruction';
export { interviewFocus, interviewGuide, interviewRound, interviewPending, interviewBlocksTool, type InterviewRound } from './interview-instruction';
export { resolvePlanTemplate } from './plan-template';
export { resolveCommitRules } from './commit-rules';
export { resolveMrRules } from './mr-rules';
export { resolveMaterialTemplate } from './section-settings';
export { PLAN_PROTOCOL_LOCKED } from './plan-template';
export { REVIEW_SKILL_AUTHORING } from './review-skill';
export { PLAN_REVIEW_SKILL_AUTHORING } from './plan-review-skill';
export { resolveReviewSkill } from './review-skill';
export { resolveMrReviewInstruction } from './mr-review-instruction';
export { CODE_FIXER_PROTOCOL } from './code-fixer-instruction';
export { resolvePlanReviewInstruction } from './plan-review-instruction';
export { resolvePlanReviewSkill } from './plan-review-skill';
export { resolveMaterialReviewInstruction } from './section-settings';
export { resolveMaterialReviewSkill } from './section-settings';
export { syncWorkspaceLibrary } from './syncer';
export { prepareReviewLibrary, restoreReviewLibrary } from './review-workspace';
export { configureDependencies as configureLibraryDependencies } from './dependencies';
export { librarianTargetTypes, librarianSectionBriefing } from './chat-context';
