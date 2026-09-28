import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { getProject } from '../../../core/projects';
import { createPtySession, getPtySession, killPtySession } from '../../terminal/pty-manager';
const terminals = new Map<string, { id: string; projectId: string; title: string; shell: string; cwd: string }>();
export const terminalsRouter = Router();
const shells = process.platform === 'win32'
  ? [{ id: 'powershell', name: 'PowerShell', command: 'powershell.exe', args: ['-NoLogo'] }, { id: 'cmd', name: 'cmd', command: 'cmd.exe', args: [] },
    ...(fs.existsSync('C:/Program Files/Git/bin/bash.exe') ? [{ id: 'bash', name: 'Git Bash', command: 'C:/Program Files/Git/bin/bash.exe', args: ['--login', '-i'] }] : [])]
  : [{ id: 'default', name: process.env.SHELL || 'bash', command: process.env.SHELL || '/bin/bash', args: ['-l'] }];
terminalsRouter.get('/shells', (_req, res) => res.json(shells.map(({ id, name }) => ({ id, name }))));
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
    const terminal = { id, projectId: project.id, title: `Терминал ${[...terminals.values()].filter(t => t.projectId === project.id).length + 1}`, shell: shell.id, cwd: project.repo_path };
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
