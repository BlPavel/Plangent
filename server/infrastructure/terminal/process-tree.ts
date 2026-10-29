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
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'ps';
  const args = windows ? ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress']
    : ['-eo', 'pid=,ppid=,comm='];
  const output = await new Promise<string>((resolve, reject) => execFile(command, args,
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const rows: { pid: number; parent: number; name: string }[] = windows
    ? [JSON.parse(output || '[]')].flat().map(row => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), name: String(row.Name) }))
    : output.split('\n').flatMap(line => { const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line); return m ? [{ pid: +m[1], parent: +m[2], name: m[3] }] : []; });
  const ids = new Set([pid]);
  let previous = 0;
  while (ids.size !== previous) { previous = ids.size; for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid); }
  return rows.filter(row => row.pid !== pid && ids.has(row.pid)).map(({ pid, name }) => ({ pid, name }));
}
