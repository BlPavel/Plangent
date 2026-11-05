import fs from 'node:fs';
import path from 'node:path';
export function resolveProjectPath(root: string, file: string): string {
  if (file.includes('\0')) throw new Error('Invalid project path');
  const base = fs.realpathSync(root);
  const target = path.resolve(base, file.replace(/\\/g, '/'));
  const inside = (candidate: string) => {
    const rel = path.relative(base, candidate);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path outside project');
  };
  inside(target);
  let ancestor = target;
  while (true) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  inside(fs.realpathSync(ancestor));
  return target;
}