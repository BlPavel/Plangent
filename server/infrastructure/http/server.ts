import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';
import { plansRouter } from './routes/plans';
import { runsRouter } from './routes/runs';
import { terminalRouter } from './routes/terminal';
import { libraryRouter } from './routes/library';
import { agentsRouter } from './routes/agents';
import { browseRouter } from './routes/browse';
import { uploadRouter } from './routes/upload';
import { clipboardRouter } from './routes/clipboard';
import { orchestratorRouter } from './routes/orchestrator';
import { attachSocket } from '../terminal/pty-manager';
import { addEventsClient } from '../../core/shared/events';

// Walk up from this file's location to find the app root. The directory depth
// differs between dev (tsx), compiled output, and packaged Electron asar.
function findAppRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const APP_ROOT = findAppRoot();
const CLIENT_DIST = path.join(APP_ROOT, 'client', 'dist');

function readAppVersion(): string {
  const pkgPath = path.join(APP_ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  }
  return '0.0.0';
}

const APP_VERSION = readAppVersion();

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
  app.use('/api/library', libraryRouter);
  app.use('/api/browse', browseRouter);
  app.use('/api/upload-temp', uploadRouter);
  app.use('/api/clipboard', clipboardRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION });
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
