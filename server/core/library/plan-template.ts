import { PLAN_PROTOCOL_LOCKED } from './builtins';
export { PLAN_PROTOCOL_LOCKED } from './builtins';
import { resolveLevelText } from './section-settings';



export function resolvePlanTemplate(projectId: string): string {
  return resolveLevelText('plan-template', projectId);
}
