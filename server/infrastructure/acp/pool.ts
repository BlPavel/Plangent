import { createHash } from 'node:crypto';
import path from 'node:path';
import type * as ACP from './types';
import { connectAdapter, type AdapterConnection } from './client';
import { startAdapter, stopAdapter } from './process';

type Callbacks = Parameters<typeof connectAdapter>[1] & { failed(reason: string): void };
type Launch = { command: string; args: string[]; env: NodeJS.ProcessEnv; version: string; shared: boolean };

/** Only known multi-session adapter families; arbitrary/custom launchers remain isolated. */
export function supportsSharedProcess(command: string, args: string[]): boolean {
  if (path.basename(command).replace(/\.cmd$/i, '').toLowerCase() !== 'npx') return false;
  if (!['--yes', '-y'].includes(args[0])) return false;
  const match = /^@agentclientprotocol\/(codex-acp|claude-agent-acp)@(\d+)\.(\d+)\.(\d+)$/.exec(args[1] ?? '');
  if (!match) return false;
  const [, name, major, minor, patch] = match;
  return name === 'codex-acp' ? +major === 2 && (+minor > 1 || +minor === 1 && +patch >= 1)
    : +major === 0 && (+minor > 85 || +minor === 85 && +patch >= 1);
}

/** Hash the entire effective environment: keys/credentials never appear in diagnostics. */
function launchKey(launch: Launch): string {
  return createHash('sha256').update(JSON.stringify([launch.command, launch.args, launch.version,
    Object.entries(launch.env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
}

function deadline<T>(job: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([job, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ACP request timed out')), ms);
  })]).finally(() => clearTimeout(timer));
}

interface Owner { callbacks: Callbacks; sessionId?: string; released: boolean }
interface Entry {
  process: ReturnType<typeof startAdapter>;
  connection?: AdapterConnection;
  ready: Promise<ACP.InitializeResponse>;
  owners: Set<Owner>;
  routes: Map<string, Owner>;
  early: ACP.SessionNotification[];
  opening: boolean;
  queue: Promise<unknown>;
  stderr: string;
  stopped?: Promise<void>;
  failed?: string;
  reusable: boolean;
  key: string;
}

export interface AdapterLease {
  process: ReturnType<typeof startAdapter>;
  connection: AdapterConnection;
  readonly stderr: string;
  release(): Promise<void>;
}

/** One process/transport, many independently owned ACP sessions. */
export class AdapterPool {
  private entries = new Map<string, Entry>();

  private forget(entry: Entry): void {
    entry.reusable = false;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  private stop(entry: Entry): Promise<void> {
    this.forget(entry);
    if (!entry.stopped) {
      entry.connection?.close();
      entry.stopped = stopAdapter(entry.process.pid);
    }
    return entry.stopped;
  }

  private create(launch: Launch, key: string): Entry {
    const child = startAdapter(launch.command, launch.args, launch.env);
    const entry: Entry = { process: child, ready: undefined!, owners: new Set(), routes: new Map(),
      early: [], opening: false, queue: Promise.resolve(), stderr: '', reusable: launch.shared, key };
    const fail = (reason: string) => {
      if (entry.stopped || entry.failed) return;
      entry.failed = reason;
      this.forget(entry);
      void this.stop(entry).catch(error => console.error('[acp] stop failed:', error));
      for (const owner of [...entry.owners]) if (!owner.released) owner.callbacks.failed(reason);
    };
    child.stderr!.on('data', chunk => { entry.stderr = (entry.stderr + chunk.toString()).slice(-8000); });
    child.on('error', error => fail(error.message));
    child.on('exit', code => fail(`Adapter exited (${code}). ${entry.stderr}`));
    entry.ready = (async () => {
      try {
        const connection = await connectAdapter(child, {
          update: event => {
            const owner = entry.routes.get(event.sessionId);
            if (owner && !owner.released) owner.callbacks.update(event);
            else if (entry.opening && entry.early.length < 1000) entry.early.push(event);
          },
          permission: request => {
            const owner = entry.routes.get(request.sessionId);
            return owner && !owner.released ? owner.callbacks.permission(request)
              : Promise.resolve({ outcome: { outcome: 'cancelled' } });
          },
        });
        entry.connection = connection;
        void connection.closed.then(() => fail(`ACP connection closed. ${entry.stderr}`));
        if (entry.failed) { connection.close(); throw new Error(entry.failed); }
        const initialized = await deadline(connection.initialize(launch.version), 90_000);
        if (!initialized.agentCapabilities?.sessionCapabilities?.close) this.forget(entry);
        return initialized;
      } catch (error) {
        fail(String(error));
        await this.stop(entry);
        throw error;
      }
    })();
    return entry;
  }

  async acquire(launch: Launch, callbacks: Callbacks): Promise<AdapterLease> {
    const key = launchKey(launch);
    const entry = (launch.shared ? this.entries.get(key) : undefined) ?? this.create(launch, key);
    if (launch.shared && entry.reusable) this.entries.set(key, entry);
    const owner: Owner = { callbacks, released: false };
    entry.owners.add(owner); // Reserve before initialize: simultaneous starts share the same handshake.
    let initialized: ACP.InitializeResponse;
    try {
      initialized = await entry.ready;
      if (entry.failed) throw new Error(entry.failed);
    }
    catch (error) { entry.owners.delete(owner); throw error; }
    if (!entry.reusable && entry.owners.values().next().value !== owner) {
      entry.owners.delete(owner);
      return this.acquire({ ...launch, shared: false }, callbacks);
    }
    const connection = entry.connection!;
    let releasing: Promise<void> | undefined;
    const release = () => releasing ??= (async () => {
      owner.released = true;
      if (owner.sessionId && entry.routes.get(owner.sessionId) === owner) entry.routes.delete(owner.sessionId);
      entry.owners.delete(owner);
      if (entry.stopped) { await entry.stopped; return; }
      if (!entry.owners.size) { await this.stop(entry); return; }
      if (owner.sessionId && !entry.stopped) {
        try { await deadline(connection.closeSession({ sessionId: owner.sessionId }), 10_000); }
        catch (error) {
          // Never kill other chats to clean up one failed close. Drain this process without reusing it.
          this.forget(entry);
          if (!entry.stopped) console.error('[acp] session close failed:', error);
        }
      }
    })();
    const bind = (sessionId: string) => {
      const existing = entry.routes.get(sessionId);
      if (existing && existing !== owner) throw new Error('ACP session is already owned by another chat');
      owner.sessionId = sessionId;
      entry.routes.set(sessionId, owner);
    };
    const open = <T>(sessionId: string | undefined, action: () => Promise<T>): Promise<T> => {
      const job = entry.queue.then(async () => {
        if (owner.released || entry.failed) throw new Error(entry.failed ?? 'ACP session closed');
        if (sessionId) bind(sessionId); // Route replay and permissions during load.
        entry.opening = true;
        try {
          const result = await action();
          const id = sessionId ?? (result as ACP.NewSessionResponse).sessionId;
          if (owner.released) {
            if (!entry.stopped) await connection.closeSession({ sessionId: id });
            throw new Error('ACP session closed');
          }
          bind(id);
          for (const event of entry.early) if (event.sessionId === id) callbacks.update(event);
          return result;
        } catch (error) {
          if (owner.sessionId && entry.routes.get(owner.sessionId) === owner) entry.routes.delete(owner.sessionId);
          throw error;
        } finally { entry.opening = false; entry.early = []; }
      });
      entry.queue = job.catch(() => {});
      return deadline(job, 90_000).catch(error => {
        // A stalled open must not admit more chats into the same process.
        if (String(error).includes('timed out')) this.forget(entry);
        throw error;
      });
    };
    return {
      process: entry.process,
      get stderr() { return entry.stderr; },
      release,
      connection: {
        ...connection,
        initialize: async () => initialized,
        newSession: params => open(undefined, () => connection.newSession(params)),
        loadSession: params => open(params.sessionId, () => connection.loadSession(params)),
        setConfig: params => deadline(connection.setConfig(params), 90_000),
        setMode: params => deadline(connection.setMode(params), 90_000),
        setModel: params => deadline(connection.setModel(params), 90_000),
        close: () => { void release().catch(error => console.error('[acp] release failed:', error)); },
      },
    };
  }
}

export const adapterPool = new AdapterPool();
