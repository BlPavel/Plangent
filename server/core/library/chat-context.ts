import type { LibraryItemType } from '../../models';

/** The screen that opened the chat owns its editing target, independently of message text. */
export function librarianTargetTypes(metadata: Record<string, unknown>): readonly LibraryItemType[] {
  const sections: Record<string, readonly LibraryItemType[]> = metadata.library_scope === 'global'
    ? {
      skills: ['skill'], 'instruction-guide': ['instruction-guide'], 'code-fixer': ['code-fixer-instruction'],
      'commit-rules': ['commit-rules'], 'plan-template': ['plan-template'], 'architecture-template': ['architecture-template'],
      'qa-template': ['qa-template'], 'plan-review': ['plan-review-instruction'], 'mr-review': ['mr-review-instruction'],
      'architecture-review': ['architecture-review-instruction'], 'qa-review': ['qa-review-instruction'], interview: ['interview-instruction'],
    }
    : {
      items: ['skill', 'command', 'main', 'plan-template', 'architecture-template', 'qa-template'],
      guide: ['instruction-guide'], fixer: ['code-fixer-instruction'], commits: ['commit-rules'],
      review: ['review-skill'], 'plan-review': ['plan-review-skill'],
      'architecture-review': ['architecture-review-skill'], 'qa-review': ['qa-review-skill'],
    };
  return typeof metadata.library_section === 'string' ? sections[metadata.library_section] ?? [] : [];
}

export function librarianSectionBriefing(metadata: Record<string, unknown>): string {
  const types = librarianTargetTypes(metadata);
  if (!types.length) return '';
  return `This chat was opened in the library section "${metadata.library_section}" at the ${metadata.library_scope ?? 'project'} level. Its editing targets are: ${types.join(', ')}. Interpret the developer's messages as changes to this section even when they omit its name. Read the current target before proposing a change (use get_instruction_text for text instructions). Proposals must stay within these target types. The editable starter text is only a convenience and does not define the editing target.`;
}
