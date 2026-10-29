import type { PermissionPolicy } from './types';

/** Modes that bypass ACP permission requests also bypass Plangent's permission checks. */
export const isBypassMode = (id: string) => /bypass|full.?access|yolo|dangerous/i.test(id);

export function selectSessionMode(ids: string[], policy: PermissionPolicy, preferred?: string, discuss = policy === 'read-only'): string | undefined {
  const safe = ids.filter(id => !isBypassMode(id));
  if (discuss || preferred === 'discuss') {
    return safe.find(id => /^plan$|read.?only/i.test(id)) ?? safe.find(id => id === 'default');
  }
  if (preferred && safe.includes(preferred)) return preferred;
  const defaults = policy === 'allow-all' || policy === 'allow-edits'
    ? ['workspace-write', 'default', 'agent', 'read-only']
    : ['default', 'read-only'];
  return defaults.find(id => safe.includes(id));
}
