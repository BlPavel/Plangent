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

export interface ChildProcessInfo { pid: number; name: string }
export async function childProcesses(pid: number): Promise<ChildProcessInfo[]> {
  return descendants(await processRows(), pid);
}
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
