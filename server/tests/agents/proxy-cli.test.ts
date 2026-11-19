import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { AgentProxyBridge } from '../../infrastructure/agent-proxy/bridge';
import { enforceAgentProxy } from '../../core/agents/sessions/env';

// Opt-in because these binaries are installed by the app, not project dependencies.
// Fake keys, isolated homes and a local API: no developer accounts or model tokens are used.
const enabled = process.env.PLANGENT_PROXY_CLI_TESTS === '1';
for (const name of ['codex', 'claude'] as const) {
  test(`${name} native runtime uses the gateway and fails closed when its upstream disconnects`, { skip: !enabled, timeout: 60000 }, async t => {
    const adapters = path.resolve('data/adapters');
    const prefix = `@agentclientprotocol+${name === 'codex' ? 'codex-acp' : 'claude-agent-acp'}@`;
    const folder = fs.readdirSync(adapters).filter(entry => entry.startsWith(prefix)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    assert.ok(folder, `${name} adapter must be installed`);
    const base = path.join(adapters, folder, 'node_modules');
    const bin = name === 'codex' ? process.execPath : path.join(base, '@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe');
    const launcher = name === 'codex' ? [path.join(base, '@openai/codex/bin/codex.js')] : [];
    if (name === 'claude' && process.platform !== 'win32') { t.skip('native Claude path in this smoke test is Windows-specific'); return; }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-proxy-cli-'));
    t.after(() => {
      const resolved = path.resolve(root);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid temporary test folder');
      fs.rmSync(resolved, { recursive: true, force: true });
    });
    const sockets = new Set<net.Socket>();
    const track = (socket: net.Socket) => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
    const forwardedPorts = new Set<number>();
    let requests = 0, direct = 0, connects = 0;
    const origin = http.createServer((req, res) => {
      requests++; if (!forwardedPorts.has(req.socket.remotePort!)) direct++;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Local proxy smoke test' } }));
    });
    origin.on('connection', track); origin.listen(0, '127.0.0.2'); await once(origin, 'listening');
    const targetPort = (origin.address() as net.AddressInfo).port;
    const upstream = http.createServer(); upstream.on('connection', track);
    upstream.on('connect', (req, client, head) => {
      connects++;
      if (req.url !== `127.0.0.2:${targetPort}`) { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
      const remote = net.connect(targetPort, '127.0.0.2', () => {
        forwardedPorts.add(remote.localPort!);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) remote.write(head);
        client.pipe(remote).pipe(client);
      });
      track(remote); client.once('close', () => remote.destroy());
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const proxyPort = (upstream.address() as net.AddressInfo).port;
    const gateway = new AgentProxyBridge();
    t.after(async () => {
      await gateway.close(); for (const socket of sockets) socket.destroy();
      await Promise.all([origin, upstream].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    });
    const inherited: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) inherited[key] = process.env[key];
    const env = enforceAgentProxy({ ...inherited, HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
      CODEX_HOME: root, CLAUDE_CONFIG_DIR: root, ANTHROPIC_API_KEY: 'sk-ant-proxy-smoke-not-a-real-key',
      PROXY_TEST_API_KEY: 'proxy-smoke-not-a-real-key', ANTHROPIC_BASE_URL: `http://127.0.0.2:${targetPort}`,
      CLAUDE_CODE_MAX_RETRIES: '0', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    }, await gateway.url());
    const args = name === 'codex' ? ['exec', '--skip-git-repo-check', '--ephemeral', '--json',
      '-c', 'model_provider="proxy_test"', '-c', 'model_providers.proxy_test.name="Proxy smoke"',
      '-c', `model_providers.proxy_test.base_url="http://127.0.0.2:${targetPort}/v1"`,
      '-c', 'model_providers.proxy_test.env_key="PROXY_TEST_API_KEY"', '-c', 'model_providers.proxy_test.wire_api="responses"',
      '-c', 'model_providers.proxy_test.request_max_retries=0', '-c', 'model_providers.proxy_test.stream_max_retries=0',
      '-c', 'features.respect_system_proxy=false', '-c', 'features.system_proxy_fallback=false',
      '-c', 'features.responses_websockets=false', '-m', 'proxy-smoke', 'ping']
      : ['--print', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--tools', '',
        '--model', 'claude-sonnet-4-6', '--max-turns', '1', '--output-format', 'json', 'ping'];
    async function run(): Promise<string> {
      const child = spawn(bin, [...launcher, ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', chunk => output = (output + chunk).slice(-8000)); child.stderr.on('data', chunk => output = (output + chunk).slice(-8000));
      const timer = setTimeout(() => child.kill(), 20000);
      try { await once(child, 'close'); } finally { clearTimeout(timer); }
      return output;
    }
    gateway.configure({ url: `http://127.0.0.1:${proxyPort}`, username: '', password: '' });
    const positive = await run();
    assert.ok(requests > 0 && connects > 0, `${folder}: runtime never reached the fake API through the gateway: ${positive}`);
    assert.equal(direct, 0, positive);
    const before = requests;
    // A broken upstream accepts then drops connections. Count attempts so a startup/auth
    // failure before any network access cannot produce a false-positive result.
    let failedAttempts = 0;
    const unavailable = net.createServer(socket => { failedAttempts++; socket.destroy(); });
    unavailable.listen(0, '127.0.0.1'); await once(unavailable, 'listening');
    t.after(() => new Promise<void>(resolve => unavailable.close(() => resolve())));
    const offlinePort = (unavailable.address() as net.AddressInfo).port;
    gateway.configure({ url: `http://127.0.0.1:${offlinePort}`, username: '', password: '' });
    const negative = await run();
    assert.ok(failedAttempts > 0, `${folder}: no upstream attempt observed: ${negative}`);
    assert.equal(requests, before, `${folder}: offline proxy allowed a direct API request: ${negative}`);
    assert.equal(direct, 0);
    t.diagnostic(`${folder}: proxied API requests=${requests}, direct API requests=${direct}; broken upstream attempts=${failedAttempts}`);
  });
}
