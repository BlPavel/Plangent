import { DEFAULT_INSTRUCTION_GUIDE } from './builtins';
export { DEFAULT_INSTRUCTION_GUIDE } from './builtins';
import { readItemContent } from './library-manager';
import { resolveLibraryItem } from './section-settings';



export function resolveInstructionGuide(projectId: string): string {
  const guide = resolveLibraryItem('instruction-guide', projectId);
  return guide ? readItemContent(guide) : DEFAULT_INSTRUCTION_GUIDE;
}
