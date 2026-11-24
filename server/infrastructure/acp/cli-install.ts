import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from '../paths';

const execFileAsync = promisify(execFile);
const prefix = path.resolve(DATA_DIR, 'agent-cli');
let pendingInstall: Promise<unknown> = Promise.resolve();

export function agentCliPath(current = ''): string {
  const bin = path.join(prefix, 'bin');
  return [...new Set([bin, ...current.split(path.delimiter).filter(Boolean)])].join(path.delimiter);
}

/** npm shares a prefix across agents, so finish each write before starting the next one. */
export function installAgentCli(spec: string): Promise<string> {
  const install = pendingInstall.then(async () => {
    try {
      const { stdout, stderr } = await execFileAsync('npm',
        ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', spec],
        { cwd: os.tmpdir(), timeout: 300_000, maxBuffer: 1024 * 1024 });
      return [stdout, stderr].filter(Boolean).join('\n').trim();
    } catch (error) {
      const e = error as Error & { stdout?: string; stderr?: string };
      throw new Error([e.message, e.stdout, e.stderr].filter(Boolean).join('\n').trim());
    }
  });
  pendingInstall = install.catch(() => {});
  return install;
}
