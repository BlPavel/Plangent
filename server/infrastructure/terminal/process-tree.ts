import { execFile, type ChildProcess } from 'child_process';
import path from 'node:path';

/** Kill descendants as well as the shell/adapter that owns them. */
export async function killProcessTree(pid: number | undefined, git?: { child: ChildProcess; onError: (error: Error) => void }): Promise<void> {
  if (git) {
    const { child, onError } = git;
  if (process.platform === 'win32') {
        // MSYS forked children may have a native parent outside taskkill's tree.
        // Capture their logical parent IDs before terminating the native tree.
        execFile('git', ['--exec-path'], { windowsHide: true }, (_error, execPath) => {
          const ps = path.resolve(execPath.trim(), '../../../usr/bin/ps.exe');
          execFile(ps, ['-W'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_psError, listing) => {
            const rows = listing.split('\n').flatMap(line => {
              const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(line);
              return match ? [{ pid: Number(match[1]), parent: Number(match[2]), native: Number(match[4]) }] : [];
            });
            execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, async (error, stdout) => {
              if (error && child.exitCode === null) { onError(error); child.kill(); }
              const killed = new Set([child.pid!, ...[...stdout.matchAll(/\d+/g)].map(match => Number(match[0]))]);
              const logical = new Set(rows.filter(row => killed.has(row.native)).map(row => row.pid));
              let previous = -1;
              while (previous !== logical.size) {
                previous = logical.size;
                for (const row of rows) if (logical.has(row.parent)) logical.add(row.pid);
              }
              for (const row of rows.filter(row => logical.has(row.pid) && !killed.has(row.native))) {
                await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(row.native), '/T', '/F'], { windowsHide: true }, () => resolve()));
              }
              child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
            });
          });
        });
      }
      else execFile('ps', ['-eo', 'pid=,ppid='], { windowsHide: true }, (error, stdout) => {
        const descendants = new Set<number>([child.pid!]);
        if (!error) {
          const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
          let previous = 0;
          while (previous !== descendants.size) {
            previous = descendants.size;
            for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid);
          }
        }
        for (const pid of [...descendants].reverse()) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
      });
    return;
  }
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'],
      { windowsHide: true }, () => resolve()));
  } else {
    try { process.kill(-pid, 'SIGTERM'); }
    catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
}

export interface ChildProcessInfo { pid: number; name: string }
/** Children of several processes from one look at the process table (it is slow on Windows). */
export async function childProcessesOf(pids: number[]): Promise<Map<number, ChildProcessInfo[]>> {
  if (!pids.length) return new Map();
  const rows = await processRows();
  return new Map(pids.map(pid => [pid, descendants(rows, pid)]));
}
type ProcessRow = { pid: number; parent: number; name: string };
async function processRows(): Promise<ProcessRow[]> {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'ps';
  const args = windows ? ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress']
    : ['-eo', 'pid=,ppid=,comm='];
  const output = await new Promise<string>((resolve, reject) => execFile(command, args,
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  return windows
    ? [JSON.parse(output || '[]')].flat().map(row => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), name: String(row.Name) }))
    : output.split('\n').flatMap(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line); return m ? [{ pid: +m[1], parent: +m[2], name: m[3] }] : []; });
}
function descendants(rows: ProcessRow[], pid: number): ChildProcessInfo[] {
  const ids = new Set([pid]);
  let previous = 0;
  while (ids.size !== previous) { previous = ids.size; for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid); }
  return rows.filter(row => row.pid !== pid && ids.has(row.pid)).map(({ pid, name }) => ({ pid, name }));
}

