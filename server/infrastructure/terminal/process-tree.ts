import { execFile } from 'child_process';

/** Kill descendants as well as the shell/adapter that owns them. */
export async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'],
      { windowsHide: true }, () => resolve()));
  } else {
    try { process.kill(-pid, 'SIGTERM'); }
    catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
}
