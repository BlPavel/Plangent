import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';
import { plansRouter } from './routes/plans';
import { runsRouter } from './routes/runs';
import { terminalRouter } from './routes/terminal';
import { skillsRouter } from './routes/skills';
import { libraryRouter } from './routes/library';
import { agentsRouter } from './routes/agents';
import { browseRouter } from './routes/browse';
import { uploadRouter } from './routes/upload';
import { clipboardRouter } from './routes/clipboard';
import { orchestratorRouter } from './routes/orchestrator';
import { attachSocket } from '../terminal/pty-manager';
import { addEventsClient } from '../../core/shared/events';

const CLIENT_DIST = path.join(process.cwd(), 'client', 'dist');

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(express.static(CLIENT_DIST));

  app.use('/api/agents', agentsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectId/tasks', tasksRouter);
  app.use('/api/projects/:projectId/tasks/:taskId/plans', plansRouter);
  app.use('/api/projects/:projectId/tasks/:taskId/runs', runsRouter);
  // Orchestrator endpoints (execute, done, orchestrator state)
  app.use('/api/projects/:projectId/tasks/:taskId', orchestratorRouter);
  app.use('/api/terminal', terminalRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/browse', browseRouter);
  app.use('/api/upload-temp', uploadRouter);
  app.use('/api/clipboard', clipboardRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0' });
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });

  const server = createServer(app);

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url!, 'http://localhost');

    if (url.pathname === '/ws/events') {
      addEventsClient(ws);
      return;
    }

    if (url.pathname === '/ws/pty') {
      const sessionId = url.searchParams.get('session');
      if (!sessionId) { ws.close(1008, 'session required'); return; }
      const ok = attachSocket(sessionId, ws);
      if (!ok) {
        ws.send(JSON.stringify({ type: 'error', message: `Session '${sessionId}' not found` }));
        ws.close(1011, 'session not found');
      }
      return;
    }

    ws.close(1008, 'unknown path');
  });

  return { app, server };
}
