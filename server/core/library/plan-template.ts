import { DEFAULT_PLAN_TEMPLATE } from './builtins';
export { PLAN_PROTOCOL_LOCKED, DEFAULT_PLAN_TEMPLATE } from './builtins';
import { readItemContent } from './library-manager';
import { resolveLibraryItem } from './section-settings';

/** The project's, group's or global template, otherwise the built-in one; a saved empty template stays empty. */
export function resolvePlanTemplate(projectId: string): string {
  const item = resolveLibraryItem('plan-template', projectId);
  return item ? readItemContent(item) : DEFAULT_PLAN_TEMPLATE;
}
