import { Router, Request, Response } from 'express';
import { createPtySession, getPtySession, listPtySessions, killPtySession } from '../../terminal/pty-manager';
import { TmuxManager } from '../../terminal/tmux';
import { getAgent } from '../../storage/agents';
import { getProject } from '../../storage/projects';
import { launchAgent } from '../../adapters/generic';

export const terminalRouter = Router();

terminalRouter.get('/sessions', (_req: Request, res: Response) => {
  res.json({ sessions: listPtySessions() });
});

// Create a new PTY session.
// If agentId + projectId are given, uses the agent's command/args/env and project's repo_path.
// Otherwise falls back to explicit cmd/args/cwd/env.
terminalRouter.post('/sessions', async (req: Request, res: Response) => {
  const { id, agentId, projectId, cmd = 'bash', args = [], cwd = process.env.HOME ?? '/', env } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  if (getPtySession(id)) return res.status(409).json({ error: 'Session already exists' });

  try {
    if (agentId && projectId) {
      const agent = getAgent(agentId);
      if (!agent) return res.status(400).json({ error: `Agent not found: ${agentId}` });

      const project = getProject(projectId);
      if (!project) return res.status(400).json({ error: `Project not found: ${projectId}` });

      const result = await launchAgent(agent, project.repo_path, id, project.config.extra_env);
      return res.status(201).json({ id, mode: result.mode, pid: result.pid });
    }

    const session = createPtySession(id, cmd, args, cwd, env);
    res.status(201).json({ id: session.id, pid: session.pty.pid });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

terminalRouter.delete('/sessions/:id', (req: Request, res: Response) => {
  killPtySession(req.params.id);
  res.status(204).end();
});

terminalRouter.post('/sessions/:id/input', (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const session = getPtySession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.pty.write(text + '\r');
  res.json({ ok: true });
});

terminalRouter.get('/tmux', (_req: Request, res: Response) => {
  const sessions = TmuxManager.listSessions();
  res.json({ sessions, tmux_available: TmuxManager.isTmuxAvailable() });
});

terminalRouter.get('/tmux/:session/output', async (req: Request, res: Response) => {
  const tmux = new TmuxManager(req.params.session);
  if (!(await tmux.exists())) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const output = await tmux.capturePane();
  res.json({ output });
});

terminalRouter.post('/tmux/:session/input', async (req: Request, res: Response) => {
  const { text, enter = true } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const tmux = new TmuxManager(req.params.session);
  if (!(await tmux.exists())) {
    return res.status(404).json({ error: 'Session not found' });
  }
  await tmux.sendKeys(text, enter);
  res.json({ ok: true });
});
