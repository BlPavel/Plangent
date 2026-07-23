import { createApp } from './infrastructure/http/server';
import { getDb } from './infrastructure/db/schema';
import { syncAll } from './core/library/syncer';
import { configureAgentRuntime } from './core/orchestration/agent-runtime';
import {
  buildPrompt,
  cleanupClaudeStopHook,
  deployClaudeStopHook,
  killAgent,
  launchAgent,
  sendToAgent,
} from './infrastructure/adapters/generic';

configureAgentRuntime({
  buildPrompt,
  launchAgent,
  killAgent,
  sendToAgent,
  deployClaudeStopHook,
  cleanupClaudeStopHook,
});

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

if (require.main === module) {
  startServer().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
