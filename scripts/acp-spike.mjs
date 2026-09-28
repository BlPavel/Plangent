import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import spawn from 'cross-spawn';
import { Readable, Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-acp-spike-'));
const adapters = { claude: '@agentclientprotocol/claude-agent-acp@0.81.2', codex: '@agentclientprotocol/codex-acp@1.13.1' };
const results = {};
for (const [name, pkg] of Object.entries(adapters)) {
  const child = spawn('npx', ['--yes', pkg], { cwd, windowsHide: true, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', c => { stderr = (stderr + c).slice(-4000); });
  const connection = client({ name: 'Plangent spike' })
    .onNotification('session/update', () => {})
    .onRequest('session/request_permission', () => ({ outcome: { outcome: 'cancelled' } }))
    .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  child.on('error', e => connection.close(e));
  child.on('exit', () => connection.close());
  const timeout = setTimeout(() => connection.close(new Error('90 second timeout')), 90_000);
  try {
    const init = await connection.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    results[name] = { initialize: init };
    const session = await connection.agent.request('session/new', { cwd, mcpServers: [] });
    results[name].session = session;
    console.log(name, 'initialize + session/new OK');
  } catch (error) {
    results[name] = { ...results[name], error: String(error), stderr };
    console.log(name, String(error));
  } finally {
    clearTimeout(timeout); connection.close();
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
    else child.kill();
  }
}
fs.writeFileSync('docs/acp-spike-results.json', JSON.stringify(results, null, 2));
