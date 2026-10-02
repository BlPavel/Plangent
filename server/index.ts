import { initSessions } from './core/agent-sessions/sessions';
import { initTaskFiles } from './core/orchestration/task-files-startup';
import { initQueues } from './core/orchestration/queue';
import { configureSessionHost, shutdownSessions } from './core/agent-sessions/acp-host';
import { sessionMcpConfig } from './infrastructure/mcp/server';
import { killProcessTree } from './infrastructure/terminal/process-tree';
import { shutdownTerminals } from './infrastructure/http/routes/terminals';
import { createApp } from './infrastructure/http/server';
import { getDb } from './infrastructure/db/schema';
import { syncAll } from './core/library/syncer';

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const DEFAULT_PORT = parseInt(process.env.PORT ?? '3001', 10);

/** Starts the local API and returns the port actually assigned by the OS. */
export async function startServer(port = DEFAULT_PORT): Promise<number> {
  getDb();
  initSessions();
  initQueues();
  initTaskFiles();
  configureSessionHost({ mcp: sessionMcpConfig, terminate: killProcessTree });

  try {
    syncAll();
  } catch (e) {
    console.error('[startup] syncAll failed:', e);
  }

  const { server } = createApp();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine the server port'));
        return;
      }
      const actualPort = address.port;
      // The orchestration callback is passed to child agents after startup.
      process.env.PLANGENT_URL = `http://127.0.0.1:${actualPort}`;
      console.log(`Plangent running at http://localhost:${actualPort}`);
      console.log(`WebSocket PTY: ws://localhost:${actualPort}/ws/pty?session=<id>`);
      resolve(actualPort);
    });
  });
}

export async function shutdown(): Promise<void> { await Promise.all([shutdownSessions(), shutdownTerminals()]); }
process.once('SIGTERM', () => { void shutdown().finally(() => process.exit()); });
process.once('SIGINT', () => { void shutdown().finally(() => process.exit()); });

if (require.main === module) {
  startServer().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
