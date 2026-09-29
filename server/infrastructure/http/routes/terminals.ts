import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getProject } from '../../../core/projects';
import { createPtySession, getPtySession, killPtySession } from '../../terminal/pty-manager';
const terminals = new Map<string, { id: string; projectId: string; title: string; shell: string; cwd: string }>();
export const terminalsRouter = Router();
// First existing candidate wins: an executable on PATH or an absolute path.
function findExecutable(...candidates: string[]) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const c of candidates) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; continue; }
    const hit = dirs.map(d => path.join(d, c)).find(p => fs.existsSync(p));
    if (hit) return hit;
  }
}
// `name` is the short chip title (like VS Code's "pwsh"), `label` is shown in the shell menu.
type Shell = { id: string; name: string; label: string; command: string; args: string[] };
// The first entry is the default shell, opened by the "+" button.
function detectShells(): Shell[] {
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/bash';
    return [{ id: 'default', name: path.basename(sh), label: path.basename(sh), command: sh, args: ['-l'] }];
  }
  const pwsh = findExecutable('pwsh.exe', 'C:/Program Files/PowerShell/7/pwsh.exe');
  const gitBash = findExecutable('C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe');
  return [
    ...(pwsh ? [{ id: 'pwsh', name: 'pwsh', label: 'PowerShell 7', command: pwsh, args: ['-NoLogo'] }] : []),
    { id: 'powershell', name: 'powershell', label: 'Windows PowerShell', command: 'powershell.exe', args: ['-NoLogo'] },
    { id: 'cmd', name: 'cmd', label: 'Command Prompt', command: 'cmd.exe', args: [] },
    ...(gitBash ? [{ id: 'bash', name: 'bash', label: 'Git Bash', command: gitBash, args: ['--login', '-i'] }] : []),
  ];
}
const shells = detectShells();
terminalsRouter.get('/shells', (_req, res) => res.json(shells.map(({ id, label }) => ({ id, label }))));
terminalsRouter.get('/', (req, res) => res.json([...terminals.values()].filter(t => !req.query.projectId || t.projectId === req.query.projectId)
  .map(t => ({ ...t, exitCode: getPtySession(t.id)?.exitCode, status: getPtySession(t.id)?.exitCode === undefined ? 'running' : 'exited' }))));
terminalsRouter.post('/', (req, res) => {
  try {
    const project = getProject(req.body.projectId);
    if (!project) throw new Error('Проект не найден');
    const shell = shells.find(s => s.id === req.body.shell) ?? shells[0];
    const id = `shell-${randomUUID()}`;
    const session = createPtySession(id, shell.command, shell.args, project.repo_path);
    session.retain = true;
    // Name after the shell ("pwsh", "pwsh 2", …), reusing the lowest free number.
    const taken = new Set([...terminals.values()].filter(t => t.projectId === project.id).map(t => t.title));
    let n = 1; while (taken.has(n === 1 ? shell.name : `${shell.name} ${n}`)) n++;
    const terminal = { id, projectId: project.id, title: n === 1 ? shell.name : `${shell.name} ${n}`, shell: shell.id, cwd: project.repo_path };
    terminals.set(id, terminal); res.status(201).json(terminal);
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
terminalsRouter.patch('/:id', (req, res) => {
  const terminal = terminals.get(req.params.id);
  if (!terminal) return res.status(404).json({ error: 'Терминал не найден' });
  if (typeof req.body.title === 'string' && req.body.title.trim()) terminal.title = req.body.title.trim().slice(0, 100);
  res.json(terminal);
});
terminalsRouter.post('/:id/:action', async (req, res) => {
  const terminal = terminals.get(req.params.id);
  if (!terminal) return res.status(404).json({ error: 'Терминал не найден' });
  try {
    if (req.params.action === 'restart') {
      await killPtySession(terminal.id);
      const shell = shells.find(s => s.id === terminal.shell)!;
      createPtySession(terminal.id, shell.command, shell.args, terminal.cwd).retain = true;
    } else if (req.params.action === 'clear') {
      const session = getPtySession(terminal.id);
      if (session) session.buffer = '';
    } else return res.status(404).end();
    res.json(terminal);
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
terminalsRouter.delete('/:id', async (req, res) => { await killPtySession(req.params.id); terminals.delete(req.params.id); res.status(204).end(); });
export async function shutdownTerminals() { await Promise.all([...terminals.keys()].map(killPtySession)); }
