import { librarySection } from '../../../common/library-registry';
import type { LibraryItemType } from '../../models';

/** The screen that opened the chat owns its editing target, independently of message text. */
export function librarianTargetTypes(metadata: Record<string, unknown>): readonly LibraryItemType[] {
  return typeof metadata.library_section === 'string'
    ? librarySection(metadata.library_scope === 'global' ? 'global' : 'project', metadata.library_section)?.types ?? []
    : [];
}

export function librarianSectionBriefing(metadata: Record<string, unknown>): string {
  const types = librarianTargetTypes(metadata);
  if (!types.length) return '';
  return `This chat was opened in the library section "${metadata.library_section}" at the ${metadata.library_scope ?? 'project'} level. Its editing targets are: ${types.join(', ')}. Interpret the developer's messages as changes to this section even when they omit its name. Read the current target before proposing a change (use get_instruction_text for text instructions). Proposals must stay within these target types. The editable starter text is only a convenience and does not define the editing target.`;
}
