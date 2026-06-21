import { createApp } from './api/server';
import { getDb } from './db/schema';
import { syncAll } from './skills/syncer';

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
