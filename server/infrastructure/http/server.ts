import { integrationsRouter } from './routes/integrations';
import { terminalsRouter } from './routes/terminals';
import { agentSessionsRouter } from './routes/agent-sessions';
import { mcpRouter } from '../mcp/server';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { projectsRouter } from './routes/projects';
import { tasksRouter } from './routes/tasks';
import { plansRouter } from './routes/plans';
import { analysisRouter } from './routes/analysis';
import { runsRouter } from './routes/runs';
import { libraryRouter } from './routes/library';
import { agentsRouter } from './routes/agents';
import { browseRouter } from './routes/browse';
import { uploadRouter } from './routes/upload';
import { clipboardRouter } from './routes/clipboard';
import { settingsRouter } from './routes/settings';
import { orchestratorRouter, queuesRouter } from './routes/orchestrator';
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
  // Clipboard screenshots are sent as base64. Keep the larger parser scoped to
  // this local-only endpoint; the default JSON limit remains in force elsewhere.
  app.use('/api/upload-temp', express.json({ limit: '25mb' }), uploadRouter);
  app.use('/api/projects/:projectId/tasks/:taskId/analysis', analysisRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use(express.json({ limit: '25mb' }));

  app.use(express.static(CLIENT_DIST));

  app.use('/api/agents', agentsRouter);
  app.use('/api/agent-sessions', agentSessionsRouter);
  app.use('/mcp', mcpRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectId/tasks', tasksRouter);
  app.use('/api/projects/:projectId/tasks/:taskId/plans', plansRouter);
  app.use('/api/projects/:projectId/tasks/:taskId/runs', runsRouter);
  // Orchestrator endpoints (execute, done, orchestrator state)
  app.use('/api/projects/:projectId/tasks/:taskId', orchestratorRouter);
  app.use('/api/queues', queuesRouter);
  app.use('/api/terminals', terminalsRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/browse', browseRouter);
  app.use('/api/clipboard', clipboardRouter);
  app.use('/api/settings', settingsRouter);

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
