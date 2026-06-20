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

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  getDb();

  try {
    syncAll();
  } catch (e) {
    console.error('[startup] syncAll failed:', e);
  }

  const { server } = createApp();

  server.listen(PORT, () => {
    console.log(`Plangent running at http://localhost:${PORT}`);
    console.log(`WebSocket PTY: ws://localhost:${PORT}/ws/pty?session=<id>`);
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
