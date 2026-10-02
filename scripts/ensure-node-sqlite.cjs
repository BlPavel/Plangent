// Development runs the backend in Node.js; packaged builds use Electron's ABI.
// Probe in a separate process so Windows releases the native DLL before a rebuild.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const probe = `
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('SELECT 1').get();
    db.close();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
`;

function checkSqlite() {
  return spawnSync(process.execPath, ['-e', probe], { cwd: root, encoding: 'utf8' });
}

function main() {
  const initial = checkSqlite();
  if (initial.error) throw initial.error;
  if (initial.status === 0) {
    console.log('[sqlite] Native module is compatible with Node.js; skipping rebuild.');
    return;
  }

  const diagnostic = initial.stderr || initial.stdout || '';
  if (!/NODE_MODULE_VERSION|Could not locate the bindings file|Cannot find module|ERR_DLOPEN_FAILED/.test(diagnostic)) {
    throw new Error(`SQLite check failed:\n${diagnostic}`);
  }

  console.log('[sqlite] Rebuilding better-sqlite3 for Node.js...');
  // npm supplies its JS entry point: invoking it through Node avoids cmd quoting.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this script through npm run electron:dev.');
  const rebuilt = spawnSync(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (rebuilt.error) throw rebuilt.error;
  if (rebuilt.status !== 0) {
    throw new Error('SQLite rebuild failed. Close running Plangent dev servers and Electron instances, then retry npm run electron:dev.');
  }

  const verified = checkSqlite();
  if (verified.error) throw verified.error;
  if (verified.status !== 0) {
    throw new Error(`SQLite still cannot load after rebuilding:\n${verified.stderr || verified.stdout || ''}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[sqlite] ${error.message}`);
  process.exitCode = 1;
}
