import http from 'node:http';
import { type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProxyConnection } from '../../models/agent-proxy';
import { connectThroughProxy } from './tunnel';

/** Authenticated loopback forward proxy. Corporate credentials never reach agent processes. */
export class AgentProxyBridge {
  private readonly token = randomBytes(32).toString('hex');
  private readonly authorization = Buffer.from('Basic ' + Buffer.from(`plangent:${this.token}`).toString('base64'));
  private readonly sockets = new Set<Socket>();
  private readonly server = http.createServer((req, res) => { void this.forward(req, res); });
  private listening: Promise<string> | undefined;
  private upstream: ProxyConnection | null = null;
  private generation = 0;

  constructor() {
    this.server.on('connection', socket => this.track(socket));
    this.server.on('connect', (req, socket, head) => { void this.tunnel(req, socket as Socket, head); });
    this.server.on('clientError', (_error, socket) => socket.destroy());
  }
  configure(upstream: ProxyConnection | null): void {
    this.upstream = upstream;
    this.generation++;
    // Credentials or routes changed: established tunnels must not keep the previous route alive.
    for (const socket of this.sockets) socket.destroy();
  }
  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => this.sockets.delete(socket));
  }
  url(): Promise<string> {
    if (!this.listening) this.listening = new Promise<string>((resolve, reject) => {
      const failed = () => { this.listening = undefined; reject(new Error('Не удалось запустить локальный прокси')); };
      this.server.once('error', failed);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', failed);
        this.server.unref();
        const port = (this.server.address() as { port: number }).port;
        resolve(`http://plangent:${this.token}@127.0.0.1:${port}`);
      });
    });
    return this.listening;
  }
  private authorized(req: http.IncomingMessage): boolean {
    const supplied = Buffer.from(req.headers['proxy-authorization'] ?? '');
    return supplied.length === this.authorization.length && timingSafeEqual(supplied, this.authorization);
  }
  private async connect(host: string, port: number): Promise<Socket> {
    const config = this.upstream, generation = this.generation;
    if (!config) throw new Error('Прокси не настроен');
    const socket = await connectThroughProxy(config, host, port, socket => this.track(socket));
    if (generation !== this.generation) { socket.destroy(); throw new Error('Настройки прокси изменились'); }
    return socket;
  }
  private async tunnel(req: http.IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    if (!this.authorized(req)) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Plangent"\r\nConnection: close\r\n\r\n'); return; }
    let upstream: Socket | undefined;
    try {
      const target = new URL(`http://${req.url}`);
      const port = Number(/:(\d+)$/.exec(req.url ?? '')?.[1]);
      if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || !port || port > 65535) throw new Error('Invalid target');
      upstream = await this.connect(target.hostname.replace(/^\[|\]$/g, ''), port);
      if (client.destroyed) { upstream.destroy(); return; }
      const remote = upstream;
      client.once('close', () => remote.destroy());
      remote.once('close', hadError => { if (hadError || !remote.readableEnded) client.destroy(); });
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote).pipe(client);
    } catch {
      upstream?.destroy();
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  }
  private async forward(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authorized(req)) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Plangent"' }); res.end(); return; }
    let socket: Socket | undefined;
    try {
      const target = new URL(req.url ?? '');
      if (target.protocol !== 'http:' || target.username || target.password || target.hash) throw new Error('Invalid target');
      socket = await this.connect(target.hostname.replace(/^\[|\]$/g, ''), Number(target.port || 80));
      if (req.destroyed) { socket.destroy(); return; }
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => socket!;
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
      const connectionHeaders = String(headers.connection ?? '').split(',').map(header => header.trim().toLowerCase());
      for (const header of ['proxy-authorization', 'proxy-connection', 'connection', ...connectionHeaders]) delete headers[header];
      const outgoing = http.request(target, { method: req.method, headers, agent }, response => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.once('close', () => { outgoing.destroy(); agent.destroy(); });
      req.once('aborted', () => outgoing.destroy());
      req.pipe(outgoing);
    } catch {
      socket?.destroy();
      if (!res.headersSent) res.writeHead(502);
      res.end('Прокси недоступен. Прямое подключение отключено.');
    }
  }
  async close(): Promise<void> {
    this.configure(null);
    if (this.listening) {
      await this.listening.catch(() => {});
      await new Promise<void>(resolve => this.server.close(() => resolve()));
      this.listening = undefined;
    }
  }
}
