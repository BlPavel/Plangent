import spawn from 'cross-spawn';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from '../paths';

const prefix = path.resolve(DATA_DIR, 'agent-cli');
let pendingInstall: Promise<unknown> = Promise.resolve();

/** npm puts global binaries in `bin` on POSIX and directly in the prefix on Windows. */
export function cliBinDirs(platform: NodeJS.Platform, base = prefix): string[] {
  return platform === 'win32' ? [base, path.join(base, 'bin')] : [path.join(base, 'bin')];
}

export function agentCliPath(current = ''): string {
  return [...new Set([...cliBinDirs(process.platform), ...current.split(path.delimiter).filter(Boolean)])].join(path.delimiter);
}

/** npm shares a prefix across agents, so finish each write before starting the next one. */
export function installAgentCli(spec: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const install = pendingInstall.then(async () => {
    const args = ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', spec];
    return new Promise<string>((resolve, reject) => {
      // Windows resolves the npm shim to npm.cmd, which Node cannot start without a shell.
      const child = spawn('npm', args, { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout!.on('data', chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); });
      child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-1024 * 1024); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('npm install не уложился в 10 минут')); }, 600_000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (code === 0) resolve(output); else reject(new Error(output || `npm install завершился (${code})`));
      });
    });
  });
  pendingInstall = install.catch(() => {});
  return install;
}
