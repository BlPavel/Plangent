import net, { type Socket } from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import type { ProxyConnection } from '../../models/agent-proxy';

const TIMEOUT_MS = 15_000;

/** Reads handshake bytes without consuming the beginning of the tunneled stream. */
class Reader {
  private buffer = Buffer.alloc(0);
  constructor(private readonly socket: Socket) {}
  private async more(): Promise<void> {
    let chunk = this.socket.read() as Buffer | null;
    if (!chunk) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.socket.off('readable', ready).off('error', failed).off('end', ended).off('close', ended);
        };
        const ready = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const ended = () => failed(new Error('Proxy closed the connection'));
        this.socket.once('readable', ready).once('error', failed).once('end', ended).once('close', ended);
        if (this.socket.destroyed || this.socket.readableEnded) ended();
      });
      chunk = this.socket.read() as Buffer | null;
    }
    if (chunk) this.buffer = Buffer.concat([this.buffer, chunk]);
  }
  async bytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) await this.more();
    const result = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return result;
  }
  async headers(): Promise<string> {
    while (this.buffer.indexOf('\r\n\r\n') < 0) {
      if (this.buffer.length > 16_384) throw new Error('Proxy response is too large');
      await this.more();
    }
    return (await this.bytes(this.buffer.indexOf('\r\n\r\n') + 4)).toString('latin1');
  }
  release(): void {
    if (this.buffer.length) this.socket.unshift(this.buffer);
  }
}

function socksAddress(host: string): Buffer {
  if (net.isIP(host) === 4) return Buffer.from([1, ...host.split('.').map(Number)]);
  if (net.isIP(host) === 6) {
    const canonical = new URL(`http://[${host}]`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::').map(part => part ? part.split(':') : []);
    const words = right ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    const result = Buffer.alloc(17); result[0] = 4;
    words.forEach((word, i) => result.writeUInt16BE(parseInt(word, 16), 1 + i * 2));
    return result;
  }
  const domain = Buffer.from(host, 'ascii');
  if (!domain.length || domain.length > 255) throw new Error('Invalid target hostname');
  // Both socks5 and socks5h resolve the provider hostname at the proxy, never locally.
  return Buffer.concat([Buffer.from([3, domain.length]), domain]);
}

/** The only outbound dial here is to the configured proxy. There is no direct fallback. */
export async function connectThroughProxy(config: ProxyConnection, host: string, port: number,
  onSocket: (socket: Socket) => void = () => {}): Promise<Socket> {
  const proxy = new URL(config.url);
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(proxy.protocol)) throw new Error('Unsupported proxy protocol');
  const hostname = proxy.hostname.replace(/^\[|\]$/g, '');
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : proxy.protocol === 'http:' ? 80 : 1080));
  const socket = proxy.protocol === 'https:'
    ? tls.connect({ host: hostname, port: proxyPort, ...(net.isIP(hostname) ? {} : { servername: hostname }),
      ...(config.ca ? { ca: [...tls.rootCertificates, config.ca] } : {}) })
    : net.connect({ host: hostname, port: proxyPort });
  onSocket(socket);
  socket.on('error', () => {});
  const timer = setTimeout(() => socket.destroy(new Error('Proxy connection timed out')), TIMEOUT_MS);
  timer.unref();
  try {
    await once(socket, proxy.protocol === 'https:' ? 'secureConnect' : 'connect');
    const reader = new Reader(socket);
    if (proxy.protocol === 'http:' || proxy.protocol === 'https:') {
      const authority = `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
      const auth = config.username || config.password
        ? `Proxy-Authorization: Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
      const status = /^HTTP\/1\.[01] (\d{3})\b/.exec(await reader.headers())?.[1];
      if (status !== '200') throw new Error(status === '407' ? 'Proxy authentication failed' : 'Proxy refused the connection');
    } else {
      const authenticated = Boolean(config.username || config.password);
      socket.write(Buffer.from(authenticated ? [5, 1, 2] : [5, 1, 0]));
      const greeting = await reader.bytes(2);
      if (greeting[0] !== 5 || greeting[1] !== (authenticated ? 2 : 0)) throw new Error('Unsupported SOCKS5 authentication');
      if (authenticated) {
        const user = Buffer.from(config.username), password = Buffer.from(config.password);
        if (!user.length || user.length > 255 || password.length > 255) throw new Error('Invalid SOCKS5 credentials');
        socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]));
        const reply = await reader.bytes(2);
        if (reply[0] !== 1 || reply[1] !== 0) throw new Error('Proxy authentication failed');
      }
      const targetPort = Buffer.alloc(2); targetPort.writeUInt16BE(port);
      socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(host), targetPort]));
      const reply = await reader.bytes(4);
      if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw new Error('SOCKS5 proxy refused the connection');
      const length = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : reply[3] === 3 ? (await reader.bytes(1))[0] : -1;
      if (length < 0) throw new Error('Invalid SOCKS5 response');
      await reader.bytes(length + 2);
    }
    reader.release();
    return socket;
  } catch {
    socket.destroy();
    // Upstream responses/errors may contain credentials. Never relay their text to agents or logs.
    throw new Error('Прокси недоступен, отклонил соединение или не принял учётные данные');
  } finally { clearTimeout(timer); }
}
