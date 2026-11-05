import { execFileSync } from 'node:child_process';
export function gitSync(root: string, args: string[]): string { return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore','pipe','ignore'] }); }
