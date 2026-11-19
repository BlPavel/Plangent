import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net, { type Socket, type Server } from 'node:net';
import { once } from 'node:events';
import { AgentProxyBridge } from './bridge';
import { connectThroughProxy } from './tunnel';

async function listen(t: TestContext, server: Server): Promise<number> {
  const sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return (server.address() as net.AddressInfo).port;
}
function auth(url: URL): string { return 'Basic ' + Buffer.from(`${url.username}:${url.password}`).toString('base64'); }
function request(proxy: string, target: string, authorized = true): Promise<{ status: number; body: string }> {
  const url = new URL(proxy);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: target, agent: false,
      headers: authorized ? { 'Proxy-Authorization': auth(url) } : {} }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject); req.end();
  });
}
async function tunnel(proxy: string, host: string, port: number): Promise<Socket> {
  const url = new URL(proxy);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, method: 'CONNECT', path: `${host}:${port}`, headers: { 'Proxy-Authorization': auth(url) } });
    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`CONNECT ${res.statusCode}`)); return; }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.once('error', reject); req.end();
  });
}

test('HTTP proxy authenticates, forwards streams and HTTP, and never falls back when unavailable', { timeout: 15000 }, async t => {
  let direct = 0, connects = 0;
  const origin = http.createServer((req, res) => { direct++; assert.equal(req.headers['proxy-authorization'], undefined); res.end('model endpoint'); });
  const targetPort = await listen(t, origin);
  const upstream = http.createServer();
  upstream.on('connect', (req, client, head) => {
    connects++;
    if (req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('employee:private-password').toString('base64')) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
    }
    const remote = net.connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote).pipe(client);
    });
    remote.on('error', () => client.destroy()); client.once('close', () => remote.destroy());
  });
  const proxyPort = await listen(t, upstream);
  const bridge = new AgentProxyBridge(); t.after(() => bridge.close());
  bridge.configure({ url: `http://127.0.0.1:${proxyPort}`, username: 'employee', password: 'private-password' });
  const local = await bridge.url();
  assert.ok(!local.includes('private-password'));
  // A name that cannot resolve locally proves the target is passed to the proxy.
  assert.deepEqual(await request(local, `http://model.provider.invalid:${targetPort}/v1`), { status: 200, body: 'model endpoint' });
  assert.equal(connects, 1); assert.equal(direct, 1);
  assert.equal((await request(local, `http://127.0.0.1:${targetPort}/v1`, false)).status, 407);
  assert.equal(connects, 1, 'unauthenticated local clients cannot use the corporate proxy');
  const socket = await tunnel(local, 'model.provider.invalid', targetPort);
  socket.on('error', () => {});
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  bridge.configure(null); await closed;
  assert.equal((await request(local, `http://127.0.0.1:${targetPort}/v1`)).status, 502);
  assert.equal(direct, 1, 'a reachable target must not receive a request when the proxy is removed');
  bridge.configure({ url: `http://127.0.0.1:${proxyPort}`, username: 'employee', password: 'wrong' });
  assert.equal((await request(local, `http://127.0.0.1:${targetPort}/v1`)).status, 502);
  assert.equal(direct, 1, 'authentication failure must not connect directly');
  const refused = net.createServer(); const refusedPort = await listen(t, refused);
  await new Promise<void>(resolve => refused.close(() => resolve()));
  bridge.configure({ url: `http://127.0.0.1:${refusedPort}`, username: '', password: '' });
  assert.equal((await request(local, `http://127.0.0.1:${targetPort}/v1`)).status, 502);
  assert.equal(direct, 1, 'an offline proxy must not connect directly');
});

for (const authenticated of [false, true]) {
  test(`SOCKS5 ${authenticated ? 'with credentials' : 'without credentials'} resolves the target at the proxy`, { timeout: 15000 }, async t => {
    let receivedHost = '', receivedPort = 0, username = '', password = '';
    const proxy = net.createServer(socket => {
      let buffer = Buffer.alloc(0), stage = 'greeting';
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greeting' && buffer.length >= 3) {
          assert.equal(buffer[0], 5); assert.equal(buffer[2], authenticated ? 2 : 0);
          buffer = buffer.subarray(3); stage = authenticated ? 'auth' : 'connect';
          // Split replies exercise partial handshake reads.
          socket.write(Buffer.from([5])); setImmediate(() => socket.write(Buffer.from([authenticated ? 2 : 0])));
        }
        if (stage === 'auth' && buffer.length >= 2 + buffer[1]) {
          const userLength = buffer[1], passwordLength = buffer[2 + userLength];
          if (passwordLength === undefined || buffer.length < 3 + userLength + passwordLength) return;
          username = buffer.subarray(2, 2 + userLength).toString();
          password = buffer.subarray(3 + userLength, 3 + userLength + passwordLength).toString();
          buffer = buffer.subarray(3 + userLength + passwordLength); stage = 'connect'; socket.write(Buffer.from([1, 0]));
        }
        if (stage === 'connect' && buffer.length >= 5 && buffer.length >= 7 + buffer[4]) {
          assert.equal(buffer[3], 3);
          receivedHost = buffer.subarray(5, 5 + buffer[4]).toString();
          receivedPort = buffer.readUInt16BE(5 + buffer[4]); stage = 'stream';
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.write('ready');
        }
      });
    });
    const port = await listen(t, proxy);
    const socket = await connectThroughProxy({ url: `socks5://127.0.0.1:${port}`, username: authenticated ? 'employee' : '', password: authenticated ? 'secret' : '' }, 'provider.invalid', 443);
    t.after(() => socket.destroy());
    assert.equal(receivedHost, 'provider.invalid'); assert.equal(receivedPort, 443);
    assert.equal(username, authenticated ? 'employee' : ''); assert.equal(password, authenticated ? 'secret' : '');
    let data = socket.read() as Buffer | null;
    if (!data) { await once(socket, 'readable'); data = socket.read() as Buffer; }
    assert.equal(data!.toString(), 'ready', 'handshake parsing preserves early tunnel bytes');
  });
}

test('SOCKS5 rejected authentication is a terminal error with no leaked response', { timeout: 15000 }, async t => {
  const proxy = net.createServer(socket => { socket.once('data', () => socket.end(Buffer.from([5, 255]))); });
  const port = await listen(t, proxy);
  await assert.rejects(connectThroughProxy({ url: `socks5://127.0.0.1:${port}`, username: 'user', password: 'private-password' }, 'provider.invalid', 443), error => {
    assert.ok(!(error as Error).message.includes('private-password')); return true;
  });
});

test('HTTPS proxy validates TLS and accepts an explicitly trusted corporate CA', { timeout: 15000 }, async t => {
  // Dedicated test-only certificate and private key; never used by the application.
  const cert = fs.readFileSync(path.resolve('server/tests/support/proxy-test-cert.pem'), 'utf8');
  const key = fs.readFileSync(path.resolve('server/tests/support/proxy-test-key.pem'), 'utf8');
  let connects = 0;
  const proxy = https.createServer({ cert, key });
  proxy.on('tlsClientError', () => {});
  proxy.on('connect', (_req, socket) => { connects++; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); });
  const port = await listen(t, proxy);
  const config = { url: `https://127.0.0.1:${port}`, username: '', password: '' };
  await assert.rejects(connectThroughProxy(config, 'provider.invalid', 443));
  assert.equal(connects, 0, 'untrusted TLS must fail before a CONNECT request');
  const socket = await connectThroughProxy({ ...config, ca: cert }, 'provider.invalid', 443);
  socket.destroy();
  assert.equal(connects, 1);
});

test('CONNECT preserves a large final streamed response when the upstream closes normally', { timeout: 15000 }, async t => {
  const payload = Buffer.alloc(1024 * 1024, 'x');
  const upstream = http.createServer();
  upstream.on('connect', (_req, socket) => socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'), payload])));
  const port = await listen(t, upstream);
  const bridge = new AgentProxyBridge(); t.after(() => bridge.close());
  bridge.configure({ url: `http://127.0.0.1:${port}`, username: '', password: '' });
  const socket = await tunnel(await bridge.url(), 'provider.invalid', 443);
  const chunks: Buffer[] = [];
  for await (const chunk of socket) chunks.push(chunk as Buffer);
  assert.deepEqual(Buffer.concat(chunks), payload);
});
