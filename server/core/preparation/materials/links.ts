import type { MaterialType } from './index';

/** Names of material link targets; an analysis section cannot take them as a slug. */
export const MATERIAL_LINK_TARGETS: readonly MaterialType[] = ['architecture', 'qa'];

/** `[[qa]]` is the whole document, `[[qa#Q3]]` one criterion or decision. Anything else is an analysis link. */
export function parseMaterialLink(link: string): { type: MaterialType; id?: string } | null {
  const match = link.match(/^(architecture|qa)(?:#(.+))?$/);
  return match ? { type: match[1] as MaterialType, ...(match[2] ? { id: match[2].trim() } : {}) } : null;
}
