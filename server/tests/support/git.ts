import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** All writes stay inside the temporary checkout owned by this fixture. */
export function createTestRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-test-repo-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  return { root, git, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
