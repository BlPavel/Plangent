import path from 'node:path';
import { DomainError } from '../../models/domain-error';
import { resolveProjectPath } from './paths';
export function codePath(root: string, file: string, allowRoot = false): string {
  try {
    const full = resolveProjectPath(root, file);
    const rel = path.relative(resolveProjectPath(root, ''), full);
    if ((!allowRoot && !rel) || rel.split(path.sep).some(p => p.toLowerCase() === '.git'))
      throw new Error('Invalid code path');
    return full;
  } catch { throw new DomainError('Invalid code path'); }
}

