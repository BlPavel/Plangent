import path from 'path';

/** Whether `file` (absolute, or relative to `root`) lies inside `root`. */
export function isInside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(root, file));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
