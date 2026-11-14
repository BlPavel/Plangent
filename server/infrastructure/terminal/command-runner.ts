import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireSlot, SlotTimeoutError } from './command-slots';
import { trimOutput } from './output-trim';
import { killProcessTree } from './process-tree';

export interface CommandRequest {
  owner: string; command: string; cwd: string; env?: NodeJS.ProcessEnv;
  /** Heavy commands wait for a free slot; light ones start at once. */
  heavy: boolean; timeoutMs: number; queueTimeoutMs?: number; signal?: AbortSignal; maxChars?: number;
}
export interface CommandResult {
  id: string; exitCode: number | null; signal: NodeJS.Signals | null;
  timedOut: boolean; cancelled: boolean; queueTimedOut: boolean;
  waitedMs: number; ranMs: number; output: string; omittedLines: number;
}

const LOG_DIR = path.join(os.tmpdir(), 'plangent-commands');
const MAX_LOG_BYTES = 32 * 1024 * 1024;
const KEPT_LOGS = 40;
const logs = new Map<string, { owner: string; file: string }>();
let cleaned = false;

function newLog(owner: string): { id: string; file: string } {
  if (!cleaned) { cleaned = true; fs.rmSync(LOG_DIR, { recursive: true, force: true }); }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const id = randomUUID().slice(0, 8), file = path.join(LOG_DIR, id + '.log');
  logs.set(id, { owner, file });
  while (logs.size > KEPT_LOGS) {
    const [oldId, old] = logs.entries().next().value!;
    logs.delete(oldId);
    fs.rm(old.file, { force: true }, () => {});
  }
  return { id, file };
}

const omitted = (id: string) => (lines: number) => `[… ${lines} lines omitted; read them with command_output id=${id} (grep or from/count)]`;

export async function runCommand(request: CommandRequest): Promise<CommandResult> {
  const { id, file } = newLog(request.owner);
  const base = { id, exitCode: null, signal: null, timedOut: false, cancelled: false, queueTimedOut: false, waitedMs: 0, ranMs: 0, output: '', omittedLines: 0 };
  let lease: Awaited<ReturnType<typeof acquireSlot>> | undefined;
  if (request.heavy) {
    try { lease = await acquireSlot(request.owner, request.command, { signal: request.signal, timeoutMs: request.queueTimeoutMs }); }
    catch (error) {
      if (error instanceof SlotTimeoutError) return { ...base, queueTimedOut: true, waitedMs: error.waitedMs };
      if (request.signal?.aborted) return { ...base, cancelled: true };
      throw error;
    }
  }
  try { return { ...(await execute(request, id, file)), waitedMs: lease?.waitedMs ?? 0 }; }
  finally { lease?.release(); }
}

function execute(request: CommandRequest, id: string, file: string): Promise<CommandResult> {
  const { signal } = request;
  return new Promise(resolve => {
    const started = Date.now();
    const out = fs.createWriteStream(file);
    let written = 0, timedOut = false, cancelled = false, spawnError: Error | undefined, killing: Promise<void> | undefined;
    const child = spawn(request.command, [], { cwd: request.cwd, env: { ...process.env, ...request.env }, shell: true, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { killing ??= killProcessTree(child.pid); };
    const onAbort = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const collect = (chunk: Buffer) => {
      if (written >= MAX_LOG_BYTES) return;
      const part = written + chunk.length > MAX_LOG_BYTES ? chunk.subarray(0, MAX_LOG_BYTES - written) : chunk;
      written += part.length;
      out.write(part);
      if (written >= MAX_LOG_BYTES) out.write('\n[output limit reached, the rest was dropped]\n');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', error => { spawnError = error; });
    child.once('close', async (code, closeSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      await killing;
      out.end(() => {
        const raw = fs.readFileSync(file, 'utf8');
        const trimmed = trimOutput(spawnError ? `${raw}\n${spawnError.message}` : raw, request.maxChars ?? 12000, omitted(id));
        resolve({ id, exitCode: code ?? (spawnError ? 127 : null), signal: closeSignal, timedOut, cancelled, queueTimedOut: false,
          waitedMs: 0, ranMs: Date.now() - started, output: trimmed.text, omittedLines: trimmed.omittedLines });
      });
    });
  });
}

/** Parts of a finished command's full log, for the session that ran it. */
export function readCommandLog(owner: string, id: string, options: { grep?: string; from?: number; count?: number; maxChars?: number } = {}): { text: string; totalLines: number } {
  const entry = logs.get(id);
  if (!entry || entry.owner !== owner) throw new Error('No output with this id; it may have been dropped');
  const lines = fs.readFileSync(entry.file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const limit = options.maxChars ?? 12000;
  const selected = options.grep
    ? lines.flatMap((line, index) => new RegExp(options.grep!, 'i').test(line) ? [`${index + 1}: ${line}`] : [])
    : lines.slice(Math.max(0, (options.from ?? 1) - 1), Math.max(0, (options.from ?? 1) - 1) + (options.count ?? 200));
  let text = '', cut = false;
  for (const line of selected) {
    const piece = (line.length > 2000 ? line.slice(0, 2000) + ' … [line cut]' : line) + '\n';
    if (text.length + piece.length > limit) { cut = true; break; }
    text += piece;
  }
  return { text: cut ? text + '[cut: narrow the request with grep or a smaller count]\n' : text, totalLines: lines.length };
}
