import spawn from 'cross-spawn';
import os from 'os';
import { killProcessTree } from '../terminal/process-tree';

const children = new Map<number, ReturnType<typeof spawn>>();

/** Always launch outside project folders so their npm configuration cannot affect adapters. */
export function startAdapter(command: string, args: string[], env: NodeJS.ProcessEnv, detached = true) {
  const child = spawn(command, args, { cwd: os.tmpdir(), env, stdio: 'pipe', windowsHide: true, detached: detached && process.platform !== 'win32' });
  if (child.pid) {
    const pid = child.pid;
    children.set(pid, child);
    child.once('close', () => { children.delete(pid); });
  }
  return child;
}
let terminate = killProcessTree;
export function configureAdapterTermination(handler: typeof killProcessTree): void { terminate = handler; }
export async function stopAdapter(pid?: number): Promise<void> {
  const child = pid ? children.get(pid) : undefined;
  if (!child) return terminate(pid);
  let dispose = () => {};
  const closed = new Promise<void>(resolve => {
    const done = () => { dispose(); resolve(); };
    const timer = setTimeout(done, 5000);
    child.once('close', done);
    dispose = () => { clearTimeout(timer); child.off('close', done); };
  });
  try { await terminate(pid); await closed; }
  finally { dispose(); }
}
